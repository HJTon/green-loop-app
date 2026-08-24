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

// ── The flat list ───────────────────────────────────────────────────────────
// Everything collected is listed as individual containers, not grouped by
// business. Grouping was a mistake: at the farm you are looking at a pile of
// physical bins, and what tells two of them apart is the serial on the side
// and how full it is, not who they came from. One tile per bin/bucket, in the
// order you actually work through them.
//
// Order: wheelie bins first, then soil bins, then buckets — buckets always at
// the bottom because they get tipped into a bin, never the other way round.
// Within each, fullest first: a full bin is a candidate to go straight in as
// it stands, and the dregs are what you use to top one up.

const CONTAINER_ORDER: Record<CollectionType, number> = {
  bins: 0,
  soil: 1,
  buckets: 2,
};

export function sortTilesForAssignment(tiles: PickupTile[]): PickupTile[] {
  return [...tiles].sort((a, b) => {
    const byType = CONTAINER_ORDER[a.collectionType] - CONTAINER_ORDER[b.collectionType];
    if (byType !== 0) return byType;
    const byFullness = b.averageFullness - a.averageFullness;
    if (byFullness !== 0) return byFullness;
    const byBusiness = a.businessName.localeCompare(b.businessName);
    if (byBusiness !== 0) return byBusiness;
    return a.serialNumber.localeCompare(b.serialNumber);
  });
}

export function getSortedUnassignedTiles(session: ConsolidationSession): PickupTile[] {
  return sortTilesForAssignment(getUnassignedTiles(session));
}

const FULLNESS_LABELS: Record<BinFullness, string> = {
  full: 'Full',
  '3-quarter': '3/4 full',
  half: 'Half full',
  quarter: '1/4 full',
};

/** "Full" / "3/4 full" / … for the badge on a tile. */
export function fullnessLabel(tile: PickupTile): string {
  const recorded = tile.fullness[0];
  if (recorded) return FULLNESS_LABELS[recorded];
  // Older sessions stored only the percentage.
  if (tile.averageFullness >= 100) return 'Full';
  if (tile.averageFullness >= 75) return '3/4 full';
  if (tile.averageFullness >= 50) return 'Half full';
  return '1/4 full';
}

/** Singular container word for a tile or content row. */
export function containerLabel(type: CollectionType): string {
  if (type === 'buckets') return 'bucket';
  if (type === 'soil') return 'soil bin';
  return 'bin';
}

/**
 * Maturing has to happen in a wheelie bin, so only those can be the bin that
 * gets filled (or go straight in as they are). Buckets and soil bins can only
 * ever be tipped into one.
 */
export function canHostMaturing(tile: PickupTile): boolean {
  return tile.collectionType === 'bins';
}

/** The contents of a bin, in the same order the assignment list uses. */
export function sortedBinContents(bin: MaturingBin): ConsolidatedContent[] {
  return [...bin.contents].sort((a, b) => {
    const byType = CONTAINER_ORDER[a.collectionType] - CONTAINER_ORDER[b.collectionType];
    if (byType !== 0) return byType;
    const byFullness = b.averageFullness - a.averageFullness;
    if (byFullness !== 0) return byFullness;
    return a.businessName.localeCompare(b.businessName);
  });
}

/** How many physical containers are in a bin, its own contents included. */
export function binItemCount(bin: MaturingBin): number {
  return bin.contents.reduce((sum, c) => sum + c.binsCount, 0);
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

// ── Bin Tracker row preview ─────────────────────────────────────────────────
// A client-side mirror of what `netlify/functions/maturing-bins-write.ts`
// builds for the sheet, so the sandbox can show the exact row a bin would
// produce without anything being written. Kept deliberately close to the
// function's own code — if the column contract changes there, change it here
// too (see the "Bin Tracker sheet contract": A date · B–F sources 1–5 ·
// G serial · H–L filled in later at the farm · M overflow names · N JSON).

export interface SourceBreakdownEntry {
  name: string;
  bins: number;
  buckets: number;
  litres: number;
}

export function buildSourceBreakdown(bin: MaturingBin): SourceBreakdownEntry[] {
  const byName = new Map<string, SourceBreakdownEntry>();

  for (const content of bin.contents) {
    const capacity =
      content.collectionType === 'bins' ? BIN_CAPACITY_LITRES : BUCKET_CAPACITY_LITRES;
    const litres = (content.averageFullness / 100) * capacity * content.binsCount;

    const entry = byName.get(content.businessName) || {
      name: content.businessName,
      bins: 0,
      buckets: 0,
      litres: 0,
    };
    if (content.collectionType === 'bins') entry.bins += content.binsCount;
    else entry.buckets += content.binsCount;
    entry.litres += litres;
    byName.set(content.businessName, entry);
  }

  return [...byName.values()].map(e => ({ ...e, litres: Math.round(e.litres) }));
}

// DD-Mon-YYYY, e.g. 29-Dec-2025. Note en-NZ renders September as "Sept".
export function formatSheetDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getDate()}-${date.toLocaleDateString('en-NZ', { month: 'short' })}-${date.getFullYear()}`;
}

export const BIN_TRACKER_COLUMNS = [
  'A Date of collection',
  'B Content from 1',
  'C Content from 2',
  'D Content from 3',
  'E Content from 4',
  'F Content from 5',
  'G Number (serial)',
  'H Colour',
  'I Date of maturation',
  'J Date of batching',
  'K Build',
  'L Notes',
  'M Content from 6+',
  'N Source breakdown (JSON)',
] as const;

export function buildBinTrackerRow(bin: MaturingBin): string[] {
  const uniqueBusinessNames = [...new Set(bin.contents.map(c => c.businessName))];
  const sources = [0, 1, 2, 3, 4].map(i => uniqueBusinessNames[i] || '');

  return [
    formatSheetDate(bin.createdDate),
    sources[0],
    sources[1],
    sources[2],
    sources[3],
    sources[4],
    bin.serialNumber,
    '', // H colour
    '', // I date of maturation
    '', // J date of batching
    '', // K build
    '', // L notes
    uniqueBusinessNames.slice(5).join(', '), // M overflow
    JSON.stringify(buildSourceBreakdown(bin)), // N
  ];
}

// ── Matching a scanned serial to something on the truck ──────────────────────

/**
 * Serials are compared loosely enough to survive how they get written down,
 * and no looser. Case and punctuation go, and so do leading zeros: the sheet
 * stores them 7-digit (`4102747`) because Sheets coerces them to numbers,
 * while the printed labels and Joe's written records are 8-digit
 * (`04102747`). Nothing fuzzier than that — a near-miss match would put one
 * business's food waste under another's name on the Bin Tracker, which is
 * exactly the record nobody can reconstruct afterwards.
 */
export function normaliseSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^0+/, '');
}

export function findTileBySerial(
  tiles: PickupTile[],
  scanned: string
): PickupTile | undefined {
  const target = normaliseSerial(scanned);
  if (!target) return undefined;
  return tiles.find(t => t.serialNumber && normaliseSerial(t.serialNumber) === target);
}
