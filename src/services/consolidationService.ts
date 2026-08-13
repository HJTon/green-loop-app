import type {
  PickupRecord,
  PickupTile,
  MaturingBin,
  ConsolidatedContent,
  ConsolidationSession,
  BinFullness,
  Client,
  CollectionType,
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

// NOTE: the 120L capacity warning that used to live here was removed on
// 2026-08-13. Tipping 120L wheelie bins into a 120L maturing bin trips it on
// almost every drop-off, so it was pure friction. Volume is still shown as a
// neutral readout on the active bin.

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
      const serialNumber = pickup.bin_serial_numbers?.[i] || '';
      tiles.push({
        id: `tile-${pickup.id}-${i}`,
        clientId: pickup.client_id,
        businessName: client?.business_name || 'Unknown',
        binsCollected: 1, // Each tile represents 1 bin/bucket
        collectionType,
        fullness: [fullness],
        averageFullness: fullnessToPercent[fullness],
        serialNumber,
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
  return addPickupsToMaturingBin(bin, [tile]);
}

// Add several pickups at once. One content row per physical bin/bucket is kept
// (not collapsed per business) so per-source volume survives — the UI groups
// them for display.
export function addPickupsToMaturingBin(
  bin: MaturingBin,
  tiles: PickupTile[]
): MaturingBin {
  const contents: ConsolidatedContent[] = tiles.map(tile => ({
    id: generateId(),
    pickupTileId: tile.id,
    clientId: tile.clientId,
    businessName: tile.businessName,
    binsCount: tile.binsCollected,
    collectionType: tile.collectionType,
    averageFullness: tile.averageFullness,
    sourceSerial: tile.serialNumber || undefined,
  }));

  return {
    ...bin,
    contents: [...bin.contents, ...contents],
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

// ── Grouping ────────────────────────────────────────────────────────────────
// A business with 4 bins collected produces 4 tiles. Assigning them one at a
// time is what made the farm screen slow, so both the "to assign" list and a
// bin's contents are grouped by business for display and acted on in bulk.

export interface BusinessGroup {
  key: string;                    // clientId + collection type
  clientId: string;
  businessName: string;
  collectionType: CollectionType;
  tiles: PickupTile[];            // still unassigned, in pickup order
  averageFullness: number;
}

export function groupUnassignedTiles(session: ConsolidationSession): BusinessGroup[] {
  const groups = new Map<string, BusinessGroup>();

  for (const tile of getUnassignedTiles(session)) {
    const key = `${tile.clientId}-${tile.collectionType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tiles.push(tile);
    } else {
      groups.set(key, {
        key,
        clientId: tile.clientId,
        businessName: tile.businessName,
        collectionType: tile.collectionType,
        tiles: [tile],
        averageFullness: tile.averageFullness,
      });
    }
  }

  // Average fullness across the group, for the badge on the row.
  return [...groups.values()].map(group => ({
    ...group,
    averageFullness: Math.round(
      group.tiles.reduce((sum, t) => sum + t.averageFullness, 0) / group.tiles.length
    ),
  }));
}

export interface BinContentGroup {
  key: string;
  clientId: string;
  businessName: string;
  collectionType: CollectionType;
  count: number;
  litres: number;
  contents: ConsolidatedContent[];
}

export function groupBinContents(bin: MaturingBin): BinContentGroup[] {
  const groups = new Map<string, BinContentGroup>();

  for (const content of bin.contents) {
    const key = `${content.clientId}-${content.collectionType}`;
    const capacity =
      content.collectionType === 'bins' ? BIN_CAPACITY_LITRES : BUCKET_CAPACITY_LITRES;
    const litres = (content.averageFullness / 100) * capacity;

    const existing = groups.get(key);
    if (existing) {
      existing.count += content.binsCount;
      existing.litres += litres;
      existing.contents.push(content);
    } else {
      groups.set(key, {
        key,
        clientId: content.clientId,
        businessName: content.businessName,
        collectionType: content.collectionType,
        count: content.binsCount,
        litres,
        contents: [content],
      });
    }
  }

  return [...groups.values()];
}

// Which tiles are sitting in this bin for a given business — used to take one
// back out without hunting for a specific content row.
export function getBinGroupForClient(
  bin: MaturingBin,
  clientId: string,
  collectionType: CollectionType
): BinContentGroup | undefined {
  return groupBinContents(bin).find(
    g => g.clientId === clientId && g.collectionType === collectionType
  );
}

// Collected wheelie bins that could become the maturing bin. Buckets can't —
// maturing has to happen in a wheelie bin.
export function getSuggestedBinSerials(
  session: ConsolidationSession
): Array<{ serial: string; businessName: string }> {
  const used = new Set(session.maturingBins.map(b => b.serialNumber));
  const seen = new Set<string>();
  const suggestions: Array<{ serial: string; businessName: string }> = [];

  for (const tile of session.pickupTiles) {
    if (tile.collectionType !== 'bins') continue;
    if (!tile.serialNumber) continue;
    if (used.has(tile.serialNumber) || seen.has(tile.serialNumber)) continue;
    seen.add(tile.serialNumber);
    suggestions.push({ serial: tile.serialNumber, businessName: tile.businessName });
  }

  return suggestions;
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
