// Sheet data service - loads and transforms data from Google Sheets via Netlify Functions

import type { Client, Route, RouteStop } from '@/types';
import type { SheetRow, SheetPickup, DateColumn } from '@/types/sheet';
import {
  parseCSV,
  parseDateColumns,
  findDateColumnIndex,
  isPickupMarked,
  formatDateForComparison,
  getDatesWithPickups
} from '@/utils/csvParser';

// Column indices (0-based) after user adds Address (B) and Delivery Instructions (C)
const COLUMNS = {
  BUSINESS_NAME: 0,        // A
  ADDRESS: 1,              // B
  DELIVERY_INSTRUCTIONS: 2, // C
  PICKUP_TYPE: 3,          // D
  START_DATE: 4,           // E
  PICKUP_DAY: 5,           // F
  PAYING_FROM: 6,          // G
  BIN_TYPE: 7,             // H
  NUM_BINS: 8,             // I
  EXTRA_PICKUP: 9,         // J
  DATE_COLUMNS_START: 10   // K onwards
};

// Cache for loaded data
let cachedRows: SheetRow[] | null = null;
let cachedDateColumns: DateColumn[] | null = null;
let cachedHeaders: string[] | null = null;

// Detect if we're in production (Netlify) or development
function isProduction(): boolean {
  return import.meta.env.PROD || window.location.hostname !== 'localhost';
}

/**
 * Load data from Google Sheets via Netlify Function
 */
async function loadFromGoogleSheets(): Promise<string[][]> {
  const response = await fetch('/.netlify/functions/sheets-read');

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

  const response = await fetch('/.netlify/functions/sheets-write', {
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
    deliveryInstructions: row[COLUMNS.DELIVERY_INSTRUCTIONS]?.trim() || '',
    pickupType: parsePickupType(row[COLUMNS.PICKUP_TYPE]),
    startDate: row[COLUMNS.START_DATE]?.trim() || '',
    pickupDay: row[COLUMNS.PICKUP_DAY]?.trim() || '',
    payingFrom: row[COLUMNS.PAYING_FROM]?.trim() || '',
    binType: parseBinType(row[COLUMNS.BIN_TYPE]),
    numberOfBins: parseInt(row[COLUMNS.NUM_BINS], 10) || 1,
    extraPickup: row[COLUMNS.EXTRA_PICKUP]?.trim() || '',
    rowIndex,
    dateColumns
  };
}

function parsePickupType(value: string | undefined): 'Week' | 'Fortnight' {
  const normalized = value?.toLowerCase().trim() || '';
  if (normalized === 'fortnight' || normalized === 'fortnightly') {
    return 'Fortnight';
  }
  return 'Week';
}

function parseBinType(value: string | undefined): 'W-Bins' | 'Bkts' {
  const normalized = value?.toLowerCase().trim() || '';
  if (normalized === 'bkts' || normalized === 'buckets' || normalized === 'bucket') {
    return 'Bkts';
  }
  return 'W-Bins';
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
        deliveryInstructions: row.deliveryInstructions,
        binType: row.binType === 'W-Bins' ? 'bins' : 'buckets',
        numberOfBins: row.numberOfBins,
        hasPaperTowels: row.extraPickup.toLowerCase().includes('paper towel'),
        pickupFrequency: row.pickupType === 'Week' ? 'Weekly' : 'Fortnightly',
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
  return {
    id: generateClientId(pickup.businessName),
    business_name: pickup.businessName,
    contact_name: '',
    contact_phone: '',
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
    active: true
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
