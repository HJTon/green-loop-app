// Sheet data service - loads and transforms data from Google Sheets via Netlify Functions

import type { Client, Route, RouteStop } from '@/types';
import type { SheetRow, SheetPickup, DateColumn } from '@/types/sheet';
import {
  parseCSV,
  parseDateColumns,
  parseSheetDate,
  findDateColumnIndex,
  isPickupMarked,
  formatDateForComparison,
  getDatesWithPickups
} from '@/utils/csvParser';
import { apiFetch } from '@/utils/apiClient';

// Column indices (0-based) — matches the `invoicing` tab layout.
// Column B ("Invoice Name") is used only by the Xero invoice script, not here,
// so the operational business name stays at column A and everything else is +1.
//
// Columns N (Manual Lat) and O (Manual Lng) are the per-client location
// override. Both default to empty; when populated they take precedence over
// the bulk-geocoded coordinates.json file AND the runtime Nominatim/Photon
// chain. Rows from older sheets that don't have these columns yet read as
// undefined, which we coerce to null below.
const COLUMNS = {
  BUSINESS_NAME: 0,          // A
  ADDRESS: 2,                // C
  CONTACT_PERSON: 3,         // D
  PHONE_NUMBER: 4,           // E
  DELIVERY_INSTRUCTIONS: 5,  // F
  PICKUP_TYPE: 6,            // G
  START_DATE: 7,             // H
  PICKUP_DAY: 8,             // I
  PAYING_FROM: 9,            // J
  BIN_TYPE: 10,              // K
  NUM_BINS: 11,              // L
  EXTRA_PICKUP: 12,          // M
  MANUAL_LAT: 13,            // N (manual location override - see README)
  MANUAL_LNG: 14,            // O
  DATE_COLUMNS_START: 15     // P onwards
};

// Cache for loaded data
let cachedRows: SheetRow[] | null = null;
let cachedDateColumns: DateColumn[] | null = null;
let cachedHeaders: string[] | null = null;

// Per-site "how to find the bins" help, keyed by normalised business name.
interface SiteInfo { instructions: string; media: string[]; }
let cachedSiteInfo: Map<string, SiteInfo> = new Map();

function siteInfoKey(businessName: string): string {
  return businessName.trim().toLowerCase();
}

// Detect if we're in production (Netlify) or development
function isProduction(): boolean {
  return import.meta.env.PROD || window.location.hostname !== 'localhost';
}

/**
 * Load data from Google Sheets via Netlify Function
 */
async function loadFromGoogleSheets(): Promise<string[][]> {
  const response = await apiFetch('/.netlify/functions/sheets-read');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to load from Google Sheets');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Load data from local CSV (for development/testing)
 */
async function loadFromLocalCSV(path: string = '/data/schedule.csv'): Promise<string[][]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load CSV: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  return parseCSV(content);
}

/**
 * Load and parse data from either Google Sheets or local CSV
 */
export async function loadCSV(path: string = '/data/schedule.csv'): Promise<void> {
  try {
    let parsed: string[][];

    if (isProduction()) {
      console.log('Loading from Google Sheets...');
      parsed = await loadFromGoogleSheets();
    } else {
      console.log('Loading from local CSV...');
      parsed = await loadFromLocalCSV(path);
    }

    if (parsed.length < 2) {
      throw new Error('Sheet must have at least a header row and one data row');
    }

    cachedHeaders = parsed[0];
    cachedDateColumns = parseDateColumns(cachedHeaders, COLUMNS.DATE_COLUMNS_START);
    cachedRows = parseDataRows(parsed.slice(1));

    // Load per-site "how to find the bins" help (production only; non-fatal).
    await loadSiteInfo();

    console.log(`Loaded ${cachedRows.length} businesses, ${cachedDateColumns.length} date columns`);
  } catch (error) {
    console.error('Error loading data:', error);
    throw error;
  }
}

/**
 * Write bin count to Google Sheets
 */
export async function writeBinCount(row: number, column: number, value: string): Promise<void> {
  if (!isProduction()) {
    console.log(`[DEV MODE] Would write "${value}" to row ${row}, column ${column}`);
    return;
  }

  const response = await apiFetch('/.netlify/functions/sheets-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ row, column, value }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to write to Google Sheets');
  }

  const result = await response.json();
  console.log('Write successful:', result.message);
}

/**
 * Load the Site Info tab into the cache. Production only — in dev there's no
 * sheet to read, so site info stays empty (the UI still lets you add it, and
 * writeSiteInfo is a no-op in dev like the other writes). Never throws.
 */
async function loadSiteInfo(): Promise<void> {
  cachedSiteInfo = new Map();
  if (!isProduction()) return;

  try {
    const response = await apiFetch('/.netlify/functions/site-info-read');
    if (!response.ok) return;
    const result = await response.json();
    const rows: string[][] = result.data || [];
    // Row 0 is the header; data from row 1.
    for (let i = 1; i < rows.length; i++) {
      const name = (rows[i]?.[0] || '').trim();
      if (!name) continue;
      const instructions = rows[i]?.[1] || '';
      const media = (rows[i]?.[2] || '')
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      cachedSiteInfo.set(siteInfoKey(name), { instructions, media });
    }
    console.log(`Loaded site info for ${cachedSiteInfo.size} site(s)`);
  } catch (error) {
    console.warn('Could not load Site Info (non-fatal):', error);
  }
}

/**
 * Look up cached site info for a business name (empty if none recorded).
 */
function getSiteInfoFor(businessName: string): SiteInfo {
  return cachedSiteInfo.get(siteInfoKey(businessName)) || { instructions: '', media: [] };
}

/**
 * Persist a site's "how to find the bins" help to the Site Info tab.
 * Updates the in-memory cache on success so the UI reflects it immediately.
 */
export async function writeSiteInfo(
  businessName: string,
  instructions: string,
  media: string[]
): Promise<void> {
  // Optimistically update the cache regardless of environment.
  cachedSiteInfo.set(siteInfoKey(businessName), { instructions, media });

  if (!isProduction()) {
    console.log('[DEV MODE] Would write Site Info for', businessName, { instructions, media });
    return;
  }

  const response = await apiFetch('/.netlify/functions/site-info-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, instructions, media }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.details || error.error || 'Failed to write Site Info');
  }
}

/**
 * Parse data rows into SheetRow objects
 */
function parseDataRows(rows: string[][]): SheetRow[] {
  return rows
    .map((row, index) => parseSheetRow(row, index + 2)) // +2 for 1-indexed and header row
    .filter((row): row is SheetRow => row !== null);
}

/**
 * Parse a single row into a SheetRow object
 */
function parseSheetRow(row: string[], rowIndex: number): SheetRow | null {
  const businessName = row[COLUMNS.BUSINESS_NAME]?.trim();
  if (!businessName) return null; // Skip empty rows

  // Parse date columns into a map
  const dateColumns = new Map<string, string>();
  if (cachedDateColumns) {
    for (const dateCol of cachedDateColumns) {
      const value = row[dateCol.index]?.trim() || '';
      if (value) {
        dateColumns.set(formatDateForComparison(dateCol.date), value);
      }
    }
  }

  return {
    businessName,
    address: row[COLUMNS.ADDRESS]?.trim() || '',
    contactPerson: row[COLUMNS.CONTACT_PERSON]?.trim() || '',
    phoneNumber: row[COLUMNS.PHONE_NUMBER]?.trim() || '',
    deliveryInstructions: row[COLUMNS.DELIVERY_INSTRUCTIONS]?.trim() || '',
    pickupType: parsePickupType(row[COLUMNS.PICKUP_TYPE]),
    startDate: row[COLUMNS.START_DATE]?.trim() || '',
    pickupDay: row[COLUMNS.PICKUP_DAY]?.trim() || '',
    payingFrom: row[COLUMNS.PAYING_FROM]?.trim() || '',
    binType: parseBinType(row[COLUMNS.BIN_TYPE]),
    numberOfBins: parseInt(row[COLUMNS.NUM_BINS], 10) || 1,
    extraPickup: row[COLUMNS.EXTRA_PICKUP]?.trim() || '',
    manualLat: parseManualCoord(row[COLUMNS.MANUAL_LAT]),
    manualLng: parseManualCoord(row[COLUMNS.MANUAL_LNG]),
    rowIndex,
    dateColumns
  };
}

/**
 * Parse a single override cell value into a number. Returns null for empty,
 * missing (old sheets that haven't been extended yet), or non-numeric cells —
 * the caller treats null as "no override set".
 */
function parseManualCoord(value: string | undefined): number | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePickupType(value: string | undefined): 'Week' | 'Fortnight' | 'FourWeek' {
  const normalized = value?.toLowerCase().trim().replace(/[\s-]+/g, '') || '';
  if (normalized === 'fortnight' || normalized === 'fortnightly') {
    return 'Fortnight';
  }
  if (
    normalized === '4week' ||
    normalized === '4weekly' ||
    normalized === 'fourweek' ||
    normalized === 'fourweekly'
  ) {
    return 'FourWeek';
  }
  return 'Week';
}

function pickupTypeToFrequency(
  pickupType: 'Week' | 'Fortnight' | 'FourWeek'
): 'Weekly' | 'Fortnightly' | 'Four-weekly' {
  switch (pickupType) {
    case 'Fortnight':
      return 'Fortnightly';
    case 'FourWeek':
      return 'Four-weekly';
    default:
      return 'Weekly';
  }
}

function parseBinType(value: string | undefined): 'W-Bins' | 'Bkts' | 'Soil' {
  const normalized = value?.toLowerCase().trim() || '';
  if (normalized === 'bkts' || normalized === 'buckets' || normalized === 'bucket') {
    return 'Bkts';
  }
  if (
    normalized === 'soil' ||
    normalized === 'greenwaste' ||
    normalized === 'green waste' ||
    normalized === 'green-waste'
  ) {
    return 'Soil';
  }
  return 'W-Bins';
}

// Map a sheet Bin Type to the app's collection_type.
function binTypeToCollectionType(binType: 'W-Bins' | 'Bkts' | 'Soil'): 'bins' | 'buckets' | 'soil' {
  if (binType === 'Bkts') return 'buckets';
  if (binType === 'Soil') return 'soil';
  return 'bins';
}

/**
 * Whether `targetDate` is a business's first scheduled visit — i.e. the day the
 * collector hands over the welcome kit. Driven by the Start Date column (H):
 * a row is a "first visit" when its Start Date parses to the target date.
 *
 * We deliberately rely on Start Date (not "earliest column in the sheet") so
 * existing customers carried into a new sheet don't get falsely flagged — their
 * Start Date sits in the past and won't match any current route date.
 */
function isFirstVisitForDate(startDate: string, targetDate: Date): boolean {
  const parsed = parseSheetDate(startDate);
  if (!parsed) return false;
  return formatDateForComparison(parsed) === formatDateForComparison(targetDate);
}

/**
 * Look up the manual lat/lng override for a business by name (case-insensitive).
 * Returns `{ lat: null, lng: null }` when no row matches or no override is set.
 * Used by transformToClient + getAllClients to surface the override on the
 * Client objects every page consumes.
 */
function getManualOverrideFor(businessName: string): { lat: number | null; lng: number | null } {
  if (!cachedRows) return { lat: null, lng: null };
  const key = businessName.trim().toLowerCase();
  const row = cachedRows.find(r => r.businessName.trim().toLowerCase() === key);
  if (!row) return { lat: null, lng: null };
  return { lat: row.manualLat, lng: row.manualLng };
}

/**
 * Look up the sheet row number for a business by name. Returns null when the
 * row can't be found (e.g. a brand-new off-sheet location). Used by
 * writeManualOverride to target the right cells.
 */
function getRowIndexFor(businessName: string): number | null {
  if (!cachedRows) return null;
  const key = businessName.trim().toLowerCase();
  const row = cachedRows.find(r => r.businessName.trim().toLowerCase() === key);
  return row?.rowIndex ?? null;
}

/**
 * Persist a manual lat/lng override (or clear it, by passing nulls) to the
 * business's row in the invoicing tab. Writes column N (manual_lat) and
 * column O (manual_lng). Updates the in-memory cache immediately on success
 * so subsequent reads see the override without a sheet refresh.
 *
 * No-ops in dev (we don't write to anything from local). Throws on a non-2xx
 * response so the caller can show an error.
 */
export async function writeManualOverride(
  businessName: string,
  lat: number | null,
  lng: number | null
): Promise<void> {
  const rowIndex = getRowIndexFor(businessName);
  if (rowIndex === null) {
    throw new Error(`Couldn't find ${businessName} in the sheet`);
  }

  // Update the cache optimistically so the optimiser uses the new coord the
  // moment the user hits Save.
  if (cachedRows) {
    for (const row of cachedRows) {
      if (row.businessName.trim().toLowerCase() === businessName.trim().toLowerCase()) {
        row.manualLat = lat;
        row.manualLng = lng;
        break;
      }
    }
  }

  if (!isProduction()) {
    console.log('[DEV MODE] Would write manual override for', businessName, { lat, lng });
    return;
  }

  // Write both cells. Empty string clears the cell — important when the driver
  // removes the override (we don't want a stale single coord left behind).
  const latVal = lat == null ? '' : String(lat);
  const lngVal = lng == null ? '' : String(lng);

  const writes = [
    { column: COLUMNS.MANUAL_LAT, value: latVal },
    { column: COLUMNS.MANUAL_LNG, value: lngVal },
  ];

  for (const w of writes) {
    const response = await apiFetch('/.netlify/functions/sheets-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: rowIndex, column: w.column, value: w.value }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.details || error.error || 'Failed to write manual override');
    }
  }
}

/**
 * Get pickups scheduled for a specific date
 */
export function getPickupsForDate(targetDate: Date): SheetPickup[] {
  if (!cachedRows || !cachedDateColumns) {
    console.warn('Data not loaded yet');
    return [];
  }

  const targetDateStr = formatDateForComparison(targetDate);
  const dateColumnIndex = findDateColumnIndex(cachedDateColumns, targetDate);

  if (dateColumnIndex === -1) {
    console.log(`No column found for date ${targetDateStr}`);
    return [];
  }

  const pickups: SheetPickup[] = [];

  for (const row of cachedRows) {
    const cellValue = row.dateColumns.get(targetDateStr) || '';
    if (isPickupMarked(cellValue)) {
      pickups.push({
        businessName: row.businessName,
        address: row.address,
        contactPerson: row.contactPerson,
        phoneNumber: row.phoneNumber,
        deliveryInstructions: row.deliveryInstructions,
        binType: binTypeToCollectionType(row.binType),
        numberOfBins: row.numberOfBins,
        hasPaperTowels: row.extraPickup.toLowerCase().includes('paper towel'),
        pickupFrequency: pickupTypeToFrequency(row.pickupType),
        startDate: row.startDate,
        isFirstVisit: isFirstVisitForDate(row.startDate, targetDate),
        rowIndex: row.rowIndex,
        dateColumnIndex
      });
    }
  }

  return pickups;
}

/**
 * Transform a SheetPickup into the app's Client type
 */
export function transformToClient(pickup: SheetPickup): Client {
  const site = getSiteInfoFor(pickup.businessName);
  const override = getManualOverrideFor(pickup.businessName);
  return {
    id: generateClientId(pickup.businessName),
    business_name: pickup.businessName,
    contact_name: pickup.contactPerson,
    contact_phone: pickup.phoneNumber,
    contact_email: '',
    address: pickup.address,
    delivery_notes: pickup.deliveryInstructions,
    collection_type: pickup.binType,
    expected_quantity: pickup.numberOfBins,
    collection_frequency: pickup.pickupFrequency,
    price_per_unit: 0,
    paper_towel_pickup: pickup.hasPaperTowels,
    special_instructions: '',
    logo_url: null,
    active: true,
    find_instructions: site.instructions,
    find_media: site.media,
    start_date: pickup.startDate,
    is_first_visit: pickup.isFirstVisit,
    manual_lat: override.lat,
    manual_lng: override.lng,
  };
}

/**
 * Generate a stable client ID from business name
 */
function generateClientId(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Transform pickups into a Route object
 */
export function transformToRoute(pickups: SheetPickup[], date: Date): Route {
  const dateStr = formatDateForComparison(date);

  const stops: RouteStop[] = pickups.map((pickup, index) => ({
    client_id: generateClientId(pickup.businessName),
    position: index + 1,
    status: 'pending' as const,
    notes: ''
  }));

  return {
    id: `route-${dateStr}`,
    route_date: dateStr,
    collector_id: '',
    stops,
    start_location: '28 Brooklands Park Drive, New Plymouth',
    destination_farm_id: '1',
    created_at: new Date().toISOString()
  };
}

/**
 * Get clients for a specific date
 */
export async function getClientsForDate(date: Date): Promise<Client[]> {
  if (!cachedRows) {
    await loadCSV();
  }
  const pickups = getPickupsForDate(date);
  return pickups.map(transformToClient);
}

/**
 * Get route for a specific date
 */
export async function getRouteForDate(date: Date): Promise<Route> {
  if (!cachedRows) {
    await loadCSV();
  }
  const pickups = getPickupsForDate(date);
  return transformToRoute(pickups, date);
}

/**
 * Get all dates that have scheduled pickups
 */
export function getAvailableDates(): Date[] {
  if (!cachedRows || !cachedDateColumns) {
    return [];
  }

  // Convert cached rows back to string arrays for getDatesWithPickups
  const dataRows: string[][] = cachedRows.map(row => {
    const arr: string[] = [];
    if (cachedDateColumns) {
      for (const dateCol of cachedDateColumns) {
        const dateStr = formatDateForComparison(dateCol.date);
        arr[dateCol.index] = row.dateColumns.get(dateStr) || '';
      }
    }
    return arr;
  });

  return getDatesWithPickups(dataRows, cachedDateColumns);
}

/**
 * Get pickup info for write-back (used when recording collection)
 */
export function getPickupWriteInfo(clientId: string, date: Date): { rowIndex: number; dateColumnIndex: number } | null {
  const pickups = getPickupsForDate(date);
  const pickup = pickups.find(p => generateClientId(p.businessName) === clientId);

  if (pickup) {
    return {
      rowIndex: pickup.rowIndex,
      dateColumnIndex: pickup.dateColumnIndex
    };
  }

  return null;
}

/**
 * Get every client in the spreadsheet (regardless of whether they're scheduled
 * for any particular date). Used by the ad-hoc / early-pickup picker.
 */
export function getAllClients(): Client[] {
  if (!cachedRows) return [];

  return cachedRows.map(row => {
    const site = getSiteInfoFor(row.businessName);
    return {
      id: generateClientId(row.businessName),
      business_name: row.businessName,
      contact_name: row.contactPerson,
      contact_phone: row.phoneNumber,
      contact_email: '',
      address: row.address,
      delivery_notes: row.deliveryInstructions,
      collection_type: binTypeToCollectionType(row.binType),
      expected_quantity: row.numberOfBins,
      collection_frequency: pickupTypeToFrequency(row.pickupType),
      price_per_unit: 0,
      paper_towel_pickup: row.extraPickup.toLowerCase().includes('paper towel'),
      special_instructions: '',
      logo_url: null,
      active: true,
      find_instructions: site.instructions,
      find_media: site.media,
      manual_lat: row.manualLat,
      manual_lng: row.manualLng,
    };
  });
}

/**
 * Get write-back info for a client that ISN'T marked Pick Up for the date
 * (i.e. an ad-hoc / early pickup). Returns the business's row index plus the
 * column index for the requested date so we can write both a "Pick Up" marker
 * and a bin count.
 *
 * Returns null if the client isn't in the sheet, or if there's no column for
 * the date (e.g. driver tried to add a pickup for a date that hasn't been
 * scheduled in the sheet yet).
 */
export function getAdHocWriteInfo(clientId: string, date: Date): { rowIndex: number; dateColumnIndex: number } | null {
  if (!cachedRows || !cachedDateColumns) return null;

  const row = cachedRows.find(r => generateClientId(r.businessName) === clientId);
  if (!row) return null;

  const dateColumnIndex = findDateColumnIndex(cachedDateColumns, date);
  if (dateColumnIndex === -1) return null;

  return {
    rowIndex: row.rowIndex,
    dateColumnIndex,
  };
}

/**
 * Write a pickup note to the "Pickup Notes" sheet tab
 */
export async function writePickupNote(params: {
  date: string;
  time: string;
  businessName: string;
  collectorName: string;
  status: 'completed' | 'skipped';
  binsCollected: number;
  notes: string;
}): Promise<void> {
  if (!isProduction()) {
    console.log('[DEV MODE] Would write pickup note:', params);
    return;
  }

  const response = await apiFetch('/.netlify/functions/pickup-notes-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to write pickup note');
  }

  const result = await response.json();
  console.log('Pickup note written:', result.message);
}

/**
 * Clear cached data (useful for refreshing)
 */
export function clearCache(): void {
  cachedRows = null;
  cachedDateColumns = null;
  cachedHeaders = null;
}

/**
 * Check if data is loaded
 */
export function isDataLoaded(): boolean {
  return cachedRows !== null;
}
