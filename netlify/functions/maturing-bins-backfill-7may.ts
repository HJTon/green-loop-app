import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-shot, idempotent backfill for the collections of Thursday 7 May 2026.
//
// The collector never finalised that day's drop-off, so `maturing-bins-write`
// was never called and the Bin Tracker has no rows at all for 7-May-2026 —
// it is the only missing Thursday between January and August 2026. The bins
// themselves went into CC8 (batched 18-Jun-2026), which is why CC8 shows only
// 8 bins while spanning a feedstock window either side of the gap.
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
// Serials are unrecoverable, so col G gets a RECON-07MAY-n placeholder. It is
// obviously not a real serial, and being unique it keeps
// `compost-build-bins-remove.ts` (which matches on buildName + serial) working.
//
// Safe to re-run: if any row already carries the collection date, nothing is
// appended. Supports ?dryRun=1.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const COLLECTION_DATE = '7-May-2026';
const MATURATION_DATE = '28-May-2026'; // 21 days, as every other row uses
const BATCHING_DATE = '18-Jun-2026';   // CC8's build date
const BUILD_NAME = 'CC8';
const NOTE = 'RECONSTRUCTED - drop-off never finalised; sources from invoicing sheet, volumes estimated';

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

function rowFor(sources: Source[], index: number): (string | number)[] {
  const names = [...new Set(sources.map(s => s.name))];
  return [
    COLLECTION_DATE,                              // A
    names[0] || '', names[1] || '', names[2] || '', // B, C, D
    names[3] || '', names[4] || '',                 // E, F
    `RECON-07MAY-${index + 1}`,                   // G  serial placeholder
    '',                                           // H  colour
    MATURATION_DATE,                              // I
    BATCHING_DATE,                                // J
    BUILD_NAME,                                   // K
    NOTE,                                         // L
    names.slice(5).join(', '),                    // M  overflow (none here)
    JSON.stringify(breakdownFor(sources)),        // N
  ];
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  try {
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'MATURING_BINS_SPREADSHEET_ID not set' }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Bin Tracker!A:N',
    });

    const existing = read.data.values || [];
    const alreadyPresent = existing
      .slice(1)
      .filter(row => (row[0] ?? '').toString().trim() === COLLECTION_DATE);

    if (alreadyPresent.length > 0) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: `${COLLECTION_DATE} already has ${alreadyPresent.length} row(s) — nothing appended`,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const rows = RECONSTRUCTED.map(rowFor);
    const totalLitres = RECONSTRUCTED.flatMap(breakdownFor).reduce((sum, e) => sum + e.litres, 0);

    if (!dryRun) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Bin Tracker!A:N',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      appended: dryRun ? 0 : rows.length,
      build: BUILD_NAME,
      totalLitres,
      rows,
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error backfilling 7 May bins:', error);
    return new Response(JSON.stringify({
      error: 'Failed to backfill 7 May bins',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
