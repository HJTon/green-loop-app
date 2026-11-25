import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-shot, idempotent backfill for the collections of Thursday 7 May 2026.
//
// The collector never finalised that day's drop-off, so `maturing-bins-write`
// was never called and 7-May-2026 is the only Thursday missing from the Bin
// Tracker between January and August 2026. The bins themselves went into CC8
// (batched 18-Jun-2026), which is why CC8 shows only 8 bins while spanning a
// feedstock window either side of the gap.
//
// What the rows below are built from:
//   - WHO: the "7 May 2026" column of the invoicing sheet, which had eight
//     businesses marked "Pick Up". Altherm is excluded — the Pickup Notes tab
//     records it as skipped at 09:48 with 0 bins, so it was billed but nothing
//     was collected.
//   - HOW GROUPED: 21-May-2026 has an identical client roster (same fortnightly
//     phase) and produced five maturing bins; the pairings here mirror it,
//     minus Altherm and minus "Junction", which appears on the 21 May bin but
//     on no invoicing row for either date.
//   - HOW FULL: estimated, not measured. Wheelie bins default to 3/4, the mean
//     of every fullness note ever written in col L (71.9%); Novotel's first bin
//     is Full, matching its own two 2026 notes ("3/4" and "Full"). Buckets are
//     1/2. The bucket contribution is 30L of ~510L, so that last guess barely
//     moves the composition.
//
// Every col N entry carries `estimated: true`, so `compost-bin-composition.ts`
// uses these volumes for the within-row split but counts the rows under
// `estimatedBins` rather than passing reconstructions off as measurements.
//
// Serials were unrecoverable at first, so col G got a RECON-07MAY-n
// placeholder. Joe found the five real serials on 2026-08-17, and this function
// now repairs those placeholders in place (see `repairSerials` below).
//
// **Which serial sat in which bin is not known** — the source they came from
// listed the five without saying what each one held, and the tab's own history
// can't disambiguate (these are reusable bins; four of the five appear on other
// dates carrying other businesses). They are assigned to the rows in the order
// they were found, which is arbitrary. Col L says so, so nobody later reads
// row 153 as evidence that bin 4102747 specifically held that Novotel bin.
//
// What the serials DO corroborate: none of the five is recorded in use anywhere
// between 7 May and CC8's batching on 18 Jun 2026, which is what you would
// expect if they were sitting in these maturing bins for that whole window.
//
// ─── Why this does NOT use values.append ──────────────────────────────────────
// The first version of this function appended to 'Bin Tracker!A:N' the same way
// `maturing-bins-write.ts` does. The tab ends with two blank rows and then a
// separator row whose only content is a "........." string in col K, and append
// resolved *that* as the table to extend — so all five rows landed in cols K:X
// with col A empty, ten columns to the right of where they belong.
//
// So this inserts at an explicit row index and writes with values.update, which
// puts the rows exactly where it says. It also keeps them in date order, since
// the tab is read chronologically by eye. `cleanupMalformed` removes any rows
// left by the append-based version; it is a no-op once they are gone.
//
// Safe to re-run; supports ?dryRun=1.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const TAB = 'Bin Tracker';
const COLLECTION_DATE = '7-May-2026';
const MATURATION_DATE = '28-May-2026'; // 21 days, as every other row uses
const BATCHING_DATE = '18-Jun-2026';   // CC8's build date
const BUILD_NAME = 'CC8';
const NOTE = 'RECONSTRUCTED - drop-off never finalised; sources from invoicing sheet, volumes estimated; serials recovered 17-Aug-2026 but not matched to individual bins';

// The five real serials, in the order they were found. Joe has them written
// down as 04102747 etc.; the leading zero is dropped here because all 260 other
// serials in the tab are stored 7-digit (Sheets coerces them to numbers), and
// `compost-build-bins-remove.ts` matches serials by exact string.
const SERIALS = ['4102747', '4102765', '4102836', '4105629', '4105149'];

const COL_DATE = 0;
const COL_SERIAL = 6;
const COL_BUILD = 10;

/** The placeholders this function used to write, before the serials turned up. */
const PLACEHOLDER_RE = /^RECON-07MAY-([1-5])$/;

interface Source {
  name: string;
  /** 'bins' = 120L wheelie bin, 'buckets' = 20L bucket. */
  type: 'bins' | 'buckets';
  /** 25 / 50 / 75 / 100, matching the app's FullnessSelector scale. */
  fullness: number;
}

const CAPACITY_LITRES = { bins: 120, buckets: 20 } as const;

// One entry per reconstructed maturing bin, primary (wheelie bin) source first.
const RECONSTRUCTED: Source[][] = [
  [{ name: 'Novotel New Plymouth', type: 'bins', fullness: 100 }],
  [
    { name: 'Novotel New Plymouth', type: 'bins', fullness: 75 },
    { name: 'TOI Foundation', type: 'buckets', fullness: 50 },
    { name: 'Clelands Construction', type: 'buckets', fullness: 50 },
  ],
  [
    { name: 'Columbus Coffee', type: 'bins', fullness: 75 },
    { name: 'TSB Bank Ltd - Call Centre and Branch', type: 'buckets', fullness: 50 },
  ],
  [{ name: 'New Plymouth Top 10 Holiday Park', type: 'bins', fullness: 75 }],
  [{ name: 'Molly Ryan Arvida', type: 'bins', fullness: 75 }],
];

/** Mirrors buildSourceBreakdown in maturing-bins-write.ts, plus the flag. */
function breakdownFor(sources: Source[]) {
  return sources.map(s => ({
    name: s.name,
    bins: s.type === 'bins' ? 1 : 0,
    buckets: s.type === 'buckets' ? 1 : 0,
    litres: Math.round((s.fullness / 100) * CAPACITY_LITRES[s.type]),
    estimated: true,
  }));
}

function rowFor(sources: Source[], index: number): string[] {
  const names = [...new Set(sources.map(s => s.name))];
  return [
    COLLECTION_DATE,                                // A
    names[0] || '', names[1] || '', names[2] || '', // B, C, D
    names[3] || '', names[4] || '',                 // E, F
    SERIALS[index],                                 // G  serial (order arbitrary)
    '',                                             // H  colour
    MATURATION_DATE,                                // I
    BATCHING_DATE,                                  // J
    BUILD_NAME,                                     // K
    NOTE,                                           // L
    names.slice(5).join(', '),                      // M  overflow (none here)
    JSON.stringify(breakdownFor(sources)),          // N
  ];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parses the tab's DD-MMM-YYYY dates; null for anything else. */
function parseSheetDate(raw: string): number | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (month === -1) return null;
  return Date.UTC(Number(m[3]), month, Number(m[1]));
}

async function getTabId(
  sheets: ReturnType<typeof getGoogleSheetsClient>,
  spreadsheetId: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets?.find(s => s.properties?.title === TAB);
  const id = tab?.properties?.sheetId;
  if (id === undefined || id === null) throw new Error(`Tab "${TAB}" not found`);
  return id;
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });

  try {
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID;
    if (!spreadsheetId) return json({ error: 'MATURING_BINS_SPREADSHEET_ID not set' }, 500);

    const sheets = getGoogleSheetsClient();
    const tabId = await getTabId(sheets, spreadsheetId);

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A:N`,
    });
    const rows = read.data.values || [];

    // ── 1. Rows the append-based version misplaced ─────────────────────────────
    // Signature: col A empty but col K holding the collection date, which is
    // what a 10-column shift produces. Real rows always carry a date in col A.
    const malformed: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const colA = (row[COL_DATE] ?? '').toString().trim();
      const colK = (row[COL_BUILD] ?? '').toString().trim();
      if (colA === '' && colK === COLLECTION_DATE) malformed.push(i);
    }

    // ── 1b. Placeholder serials to replace with the real ones ─────────────────
    // The five rows are already in the sheet from the first run, so the serials
    // have to be patched in place rather than written at insert time. Matching
    // on the placeholder makes this a no-op once it has run, and means a row
    // someone has already corrected by hand is left alone.
    const serialRepairs: Array<{ rowNumber: number; from: string; to: string }> = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if ((row[COL_DATE] ?? '').toString().trim() !== COLLECTION_DATE) continue;
      const serial = (row[COL_SERIAL] ?? '').toString().trim();
      const m = PLACEHOLDER_RE.exec(serial);
      if (!m) continue;
      serialRepairs.push({
        rowNumber: i + 1,
        from: serial,
        to: SERIALS[Number(m[1]) - 1],
      });
    }

    // ── 2. Already correctly present? ──────────────────────────────────────────
    const alreadyPresent = rows
      .slice(1)
      .filter(row => (row[COL_DATE] ?? '').toString().trim() === COLLECTION_DATE).length;

    // ── 3. Where the rows belong, keeping the tab in date order ────────────────
    const target = parseSheetDate(COLLECTION_DATE)!;
    let insertAt = rows.length; // 0-based index of the first inserted row
    for (let i = 1; i < rows.length; i++) {
      const d = parseSheetDate((rows[i]?.[COL_DATE] ?? '').toString());
      if (d !== null && d > target) {
        insertAt = i;
        break;
      }
    }

    const newRows = RECONSTRUCTED.map(rowFor);
    const totalLitres = RECONSTRUCTED.flatMap(breakdownFor).reduce((s, e) => s + e.litres, 0);
    const plan = {
      malformedRowsToDelete: malformed.map(i => i + 1), // 1-based, for eyeballing
      alreadyPresent,
      serialRepairs,
      willInsertAtSheetRow: insertAt + 1,
      rowsToInsert: alreadyPresent > 0 ? 0 : newRows.length,
    };

    if (dryRun) return json({ success: true, dryRun: true, ...plan, totalLitres, rows: newRows });

    // ── 3b. Patch the placeholder serials, and the note that explains them ────
    // Done before any row deletion below, while the indices from the read above
    // are still valid.
    if (serialRepairs.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: serialRepairs.flatMap(r => [
            { range: `${TAB}!G${r.rowNumber}`, values: [[r.to]] },
            { range: `${TAB}!L${r.rowNumber}`, values: [[NOTE]] },
          ]),
        },
      });
    }

    // ── 4. Delete the misplaced rows, bottom-up so indices stay valid ──────────
    if (malformed.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [...malformed].reverse().map(i => ({
            deleteDimension: {
              range: { sheetId: tabId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
            },
          })),
        },
      });
      // Deletions above the insertion point shift it up.
      insertAt -= malformed.filter(i => i < insertAt).length;
    }

    if (alreadyPresent > 0) {
      return json({
        success: true,
        skipped: true,
        deletedMalformed: malformed.length,
        serialsRepaired: serialRepairs.length,
        repairs: serialRepairs,
        message: `${COLLECTION_DATE} already has ${alreadyPresent} correctly-placed row(s) — nothing inserted`,
      });
    }

    // ── 5. Make room, then write to an explicit range ──────────────────────────
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: {
              sheetId: tabId,
              dimension: 'ROWS',
              startIndex: insertAt,
              endIndex: insertAt + newRows.length,
            },
            inheritFromBefore: false,
          },
        }],
      },
    });

    const firstRow = insertAt + 1; // 1-based
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A${firstRow}:N${firstRow + newRows.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newRows },
    });

    return json({
      success: true,
      dryRun: false,
      deletedMalformed: malformed.length,
      inserted: newRows.length,
      atSheetRows: `${firstRow}-${firstRow + newRows.length - 1}`,
      build: BUILD_NAME,
      totalLitres,
    });
  } catch (error) {
    console.error('Error backfilling 7 May bins:', error);
    return json({
      error: 'Failed to backfill 7 May bins',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};
