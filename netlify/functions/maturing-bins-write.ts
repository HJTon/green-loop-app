import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

interface MaturingBinContent {
  id: string;
  pickupTileId: string;
  clientId: string;
  businessName: string;
  binsCount: number;
  collectionType: 'bins' | 'buckets';
  averageFullness: number;
}

interface MaturingBin {
  id: string;
  serialNumber: string;
  createdDate: string;
  readyDate: string;
  contents: MaturingBinContent[];
  collectorId: string;
  farmId: string;
  notes: string;
  status: 'maturing' | 'ready' | 'processed';
}

interface WriteRequest {
  bin: MaturingBin;
  collectorName: string;
  farmName: string;
}

// Initialize Google Sheets API with service account credentials
function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// Litres per collection type. Mirrors src/services/consolidationService.ts —
// a wheelie bin holds 120L, a bucket 20L, and anything else is treated as a
// bucket rather than guessed upward.
const CAPACITY_LITRES: Record<string, number> = { bins: 120, buckets: 20 };

interface SourceBreakdownEntry {
  name: string;
  bins: number;
  buckets: number;
  litres: number;
}

/**
 * Collapse a bin's contents (one row per physical bin/bucket tipped in) into
 * one entry per business, with the volume each contributed.
 */
function buildSourceBreakdown(contents: MaturingBinContent[]): SourceBreakdownEntry[] {
  const byName = new Map<string, SourceBreakdownEntry>();

  for (const content of contents) {
    const capacity = CAPACITY_LITRES[content.collectionType] ?? CAPACITY_LITRES.buckets;
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

// Format date for display (DD-Mon-YYYY, e.g., 29-Dec-2025)
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleDateString('en-NZ', { month: 'short' });
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

const TAB = 'Bin Tracker';
const COL_DATE = 0; // col A — the one column every real row fills

// Tab id, cached across warm invocations. It only changes if the tab is
// recreated, and a stale one fails the insert loudly rather than writing
// anywhere unexpected — the client then queues the bin for retry.
let cachedTabId: number | null = null;

async function getTabId(
  sheets: ReturnType<typeof getGoogleSheetsClient>,
  spreadsheetId: string
): Promise<number> {
  if (cachedTabId !== null) return cachedTabId;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets?.find(s => s.properties?.title === TAB);
  const id = tab?.properties?.sheetId;
  if (id === undefined || id === null) throw new Error(`Tab "${TAB}" not found`);
  cachedTabId = id;
  return id;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parses the tab's DD-MMM-YYYY dates; null for anything else. Matches on the
 * month's first three letters because `formatDate` renders September as
 * "Sept" under en-NZ — same tolerance as the monitor's `parseTrackerDate`.
 */
function parseSheetDate(raw: string): number | null {
  const m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month === -1) return null;
  return Date.UTC(Number(m[3]), month, Number(m[1]));
}

/**
 * 0-based row index the new row should take, keeping col A in date order.
 * Rows with no parseable date in col A — the two trailing blanks and the
 * separator row — are never mistaken for the end of the table.
 */
function findInsertIndex(rows: string[][], collectionDate: string): number {
  const target = parseSheetDate(collectionDate);
  let lastDated = 0; // header; a tab with no dated rows at all inserts at index 1
  for (let i = 1; i < rows.length; i++) {
    const d = parseSheetDate((rows[i]?.[COL_DATE] ?? '').toString());
    if (d === null) continue;
    if (target !== null && d > target) return i;
    lastDated = i;
  }
  return lastDated + 1;
}

export default async (request: Request, context: Context) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Maturing bins spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: WriteRequest = await request.json();
    const { bin, collectorName } = body;

    if (!bin || !bin.serialNumber) {
      return new Response(JSON.stringify({ error: 'Missing required fields: bin, serialNumber' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    // Extract unique business names for locations (up to 5)
    const uniqueBusinessNames = [...new Set(bin.contents.map(c => c.businessName))];
    const sources = [0, 1, 2, 3, 4].map(i => uniqueBusinessNames[i] || '');

    // Anything past the 5 "Content from" columns used to be dropped on the
    // floor — a bin fed by 6+ businesses silently lost the rest. B–F stay as
    // they are (the compost monitor and Caroline both read them), and the
    // overflow goes in col M instead of vanishing.
    const overflowSources = uniqueBusinessNames.slice(5).join(', ');

    // Per-source breakdown, col N. The compost monitor derives each build's
    // feedstock composition from these numbers; without them it falls back to
    // a positional 5:4:3:2:1 guess based on the order things happened to be
    // assigned at the farm. Litres is the meaningful share (a quarter-full
    // bucket is not a full wheelie bin), with counts kept alongside.
    const breakdown = buildSourceBreakdown(bin.contents);

    const collectionDate = formatDate(bin.createdDate);

    // Prepare row data to match current Bin Tracker columns (updated 2026-08-13):
    // A: Date of collection
    // B–F: Content from (sources 1–5)
    // G: Number (bin serial)
    // H–L: Left blank — colour / maturation / batching / batch / notes, filled in later
    // M: Content from 6+ (overflow names)
    // N: Source breakdown (JSON)
    const rowData = [
      collectionDate,
      sources[0],
      sources[1],
      sources[2],
      sources[3],
      sources[4],
      bin.serialNumber,
      '', // H colour
      '', // I date of maturation
      '', // J date of batching
      '', // K batch
      '', // L notes
      overflowSources,
      JSON.stringify(breakdown),
    ];

    // ─── Placement, not `values.append` ───────────────────────────────────────
    // Append picks the "table" to extend by scanning the range, and this tab
    // ends with two blank rows then a separator row whose only content is a
    // "........." string in col K. On 2026-08-13 an identical append to
    // 'Bin Tracker!A:N' resolved *that* as the table and put ten rows in cols
    // K:X with col A empty (see maturing-bins-backfill-7may.ts). So we find the
    // row ourselves from col A, open a gap, and write to an explicit range.
    //
    // Reading A:A is enough: the read stops at the last row holding a col A
    // value, which is the last real row — the blanks and the separator (whose
    // content is in K) fall off the end.
    const tabId = await getTabId(sheets, spreadsheetId);
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A:A`,
    });
    const insertAt = findInsertIndex((read.data.values as string[][]) || [], collectionDate);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: { sheetId: tabId, dimension: 'ROWS', startIndex: insertAt, endIndex: insertAt + 1 },
            // Inherit from the row below, so a manually highlighted row above
            // doesn't hand its fill to a fresh bin.
            inheritFromBefore: false,
          },
        }],
      },
    });

    const rowNumber = insertAt + 1; // 1-based, as the sheet numbers it
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A${rowNumber}:N${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowData] },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Added maturing bin ${bin.serialNumber}`,
      serialNumber: bin.serialNumber,
      row: rowNumber,
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error writing to maturing bins sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write to maturing bins sheet',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
