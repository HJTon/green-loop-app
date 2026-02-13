import type {
  PickupRecord,
  PickupTile,
  MaturingBin,
  ConsolidatedContent,
  ConsolidationSession,
  BinFullness,
  Client,
} from '@/types';
import { generateId, getCurrentDate } from '@/utils/storage';

// Convert fullness to percentage
const fullnessToPercent: Record<BinFullness, number> = {
  quarter: 25,
  half: 50,
  '3-quarter': 75,
  full: 100,
};

// Volume constants in litres
export const BIN_CAPACITY_LITRES = 120;
export const BUCKET_CAPACITY_LITRES = 20;

// Calculate volume in litres for a tile
export function calculateTileVolume(tile: PickupTile): number {
  const capacity = tile.collectionType === 'bins' ? BIN_CAPACITY_LITRES : BUCKET_CAPACITY_LITRES;
  return (tile.averageFullness / 100) * capacity;
}

// Calculate total volume in a maturing bin
export function calculateMaturingBinVolume(bin: MaturingBin): number {
  return bin.contents.reduce((total, content) => {
    const capacity = content.collectionType === 'bins' ? BIN_CAPACITY_LITRES : BUCKET_CAPACITY_LITRES;
    return total + (content.averageFullness / 100) * capacity;
  }, 0);
}

// Check if adding a tile would exceed bin capacity
export function wouldExceedCapacity(bin: MaturingBin, tile: PickupTile): boolean {
  const currentVolume = calculateMaturingBinVolume(bin);
  const newVolume = calculateTileVolume(tile);
  return (currentVolume + newVolume) > BIN_CAPACITY_LITRES;
}

// Get volume warning message
export function getVolumeWarning(bin: MaturingBin, tile: PickupTile): string | null {
  const currentVolume = calculateMaturingBinVolume(bin);
  const newVolume = calculateTileVolume(tile);
  const totalVolume = currentVolume + newVolume;

  if (totalVolume > BIN_CAPACITY_LITRES) {
    return `This will be ${Math.round(totalVolume)}L total, exceeding the ${BIN_CAPACITY_LITRES}L bin capacity. Are you sure?`;
  }
  return null;
}

// Calculate average fullness percentage
export function calculateAverageFullness(fullness: BinFullness[]): number {
  if (fullness.length === 0) return 0;
  const total = fullness.reduce((sum, f) => sum + fullnessToPercent[f], 0);
  return Math.round(total / fullness.length);
}

// Create pickup tiles from completed pickups - one tile per individual bin/bucket
export function createPickupTilesFromPickups(
  pickups: PickupRecord[],
  clients: Client[]
): PickupTile[] {
  const completedPickups = pickups.filter(p => p.status === 'completed');
  const tiles: PickupTile[] = [];

  completedPickups.forEach(pickup => {
    const client = clients.find(c => c.id === pickup.client_id);
    const collectionType = client?.collection_type || 'bins';

    // Create one tile for each bin/bucket collected
    for (let i = 0; i < pickup.bins_collected; i++) {
      const fullness = pickup.bin_fullness[i] || 'full';
      tiles.push({
        id: `tile-${pickup.id}-${i}`,
        clientId: pickup.client_id,
        businessName: client?.business_name || 'Unknown',
        binsCollected: 1, // Each tile represents 1 bin/bucket
        collectionType,
        fullness: [fullness],
        averageFullness: fullnessToPercent[fullness],
        isAssigned: false,
      });
    }
  });

  return tiles;
}

// Create a new maturing bin
export function createMaturingBin(
  serialNumber: string,
  collectorId: string,
  farmId: string
): MaturingBin {
  const createdDate = getCurrentDate();
  const readyDate = calculateReadyDate(createdDate);

  return {
    id: generateId(),
    serialNumber,
    createdDate,
    readyDate,
    contents: [],
    collectorId,
    farmId,
    notes: '',
    status: 'maturing',
  };
}

// Calculate ready date (21 days from created date)
export function calculateReadyDate(createdDate: string): string {
  const date = new Date(createdDate);
  date.setDate(date.getDate() + 21);
  return date.toISOString().split('T')[0];
}

// Add pickup to maturing bin
export function addPickupToMaturingBin(
  bin: MaturingBin,
  tile: PickupTile
): MaturingBin {
  const content: ConsolidatedContent = {
    id: generateId(),
    pickupTileId: tile.id,
    clientId: tile.clientId,
    businessName: tile.businessName,
    binsCount: tile.binsCollected,
    collectionType: tile.collectionType,
    averageFullness: tile.averageFullness,
  };

  return {
    ...bin,
    contents: [...bin.contents, content],
  };
}

// Remove pickup from maturing bin
export function removePickupFromMaturingBin(
  bin: MaturingBin,
  pickupTileId: string
): MaturingBin {
  return {
    ...bin,
    contents: bin.contents.filter(c => c.pickupTileId !== pickupTileId),
  };
}

// Create a new consolidation session
export function createConsolidationSession(
  collectorId: string,
  pickups: PickupRecord[],
  clients: Client[]
): ConsolidationSession {
  return {
    id: generateId(),
    date: getCurrentDate(),
    collectorId,
    pickupTiles: createPickupTilesFromPickups(pickups, clients),
    maturingBins: [],
    completedAt: null,
  };
}

// Check if all pickups are assigned
export function allPickupsAssigned(session: ConsolidationSession): boolean {
  return session.pickupTiles.every(tile => tile.isAssigned);
}

// Get unassigned pickup tiles
export function getUnassignedTiles(session: ConsolidationSession): PickupTile[] {
  return session.pickupTiles.filter(tile => !tile.isAssigned);
}

// Get assigned pickup count
export function getAssignedCount(session: ConsolidationSession): number {
  return session.pickupTiles.filter(tile => tile.isAssigned).length;
}

// Format maturing bin data for export
export function formatMaturingBinForExport(bin: MaturingBin, collectorName: string, farmName: string) {
  const totalBins = bin.contents
    .filter(c => c.collectionType === 'bins')
    .reduce((sum, c) => sum + c.binsCount, 0);

  const totalBuckets = bin.contents
    .filter(c => c.collectionType === 'buckets')
    .reduce((sum, c) => sum + c.binsCount, 0);

  const contentsDescription = bin.contents
    .map(c => `${c.businessName} (${c.binsCount} ${c.collectionType})`)
    .join(', ');

  return {
    serialNumber: bin.serialNumber,
    dateStored: bin.createdDate,
    readyDate: bin.readyDate,
    totalBins,
    totalBuckets,
    contents: contentsDescription,
    collector: collectorName,
    farm: farmName,
    notes: bin.notes,
  };
}

// Format ready date for display
export function formatReadyDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
  });
}

// Check if bin is ready for processing
export function isBinReady(bin: MaturingBin): boolean {
  const today = new Date();
  const readyDate = new Date(bin.readyDate);
  return today >= readyDate;
}
