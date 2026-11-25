import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-shot, idempotent correction of the 20-Aug-2026 farm bins (Bin Tracker rows 274–284).
//
// That day's drop-off record put almost every business into one maturing bin (4105130:
// ten businesses, 825 L), left five bins with no sources, and missed 4102845 entirely.
// The team wrote what really went where in col L at the time. This rewrites B–F, M and N
// (and G for the misnumbered bin) to match those notes, confirmed by Joe on 2-Oct-2026.
//
// Volumes are the day's measured litres per business, taken from the original col N.
// Where a business's two bins were split across farm bins (Novotel, Plymouth International:
// 2 bins, 150 L) each half is 75 L; Butlers' 90 L and 60 L bins follow the notes. Mitre 10's
// 30 L is dropped: their green waste goes to Marfell, not a farm bin.
//
// Guarded: a row is only written if col A is still 20-Aug-2026 and col G still holds the
// serial we expect (old or corrected). Re-running after success is a no-op. ?dryRun=1 writes nothing.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const TAB = 'Bin Tracker';
const DATE = '20-Aug-2026';
const NOTE_SUFFIX = ' [corrected from notes 2-Oct-2026]';

type Src = { name: string; bins?: number; buckets?: number; litres: number };
interface Fix { row: number; serial: string; newSerial?: string; sources: Src[] }

const FIXES: Fix[] = [
  { row: 274, serial: '4105123', sources: [{ name: 'Columbus Coffee', bins: 1, litres: 120 }, { name: 'Life Skills', bins: 1, litres: 30 }] },
  { row: 275, serial: '4102176', sources: [{ name: 'NP Community Foodbank Trust', bins: 1, litres: 120 }] },
  { row: 276, serial: '4102838', sources: [{ name: 'Southern Cross New Plymouth Hospital', bins: 1, litres: 120 }] },
  { row: 277, serial: '4105156', sources: [{ name: 'Butlers Reef', bins: 1, litres: 90 }, { name: 'Venture Taranaki', buckets: 1, litres: 20 }] },
  { row: 278, serial: '4105130', newSerial: '4105159', sources: [{ name: 'Millennium Hotel New Plymouth', bins: 1, litres: 90 }] },
  { row: 279, serial: '4105262', sources: [{ name: 'Auto Lodge Motel New Plymouth', bins: 1, litres: 30 }, { name: 'Plymouth International Hotel', bins: 1, litres: 75 }] },
  { row: 280, serial: '4105129', sources: [{ name: 'TOI Foundation', buckets: 1, litres: 15 }, { name: 'Plymouth International Hotel', bins: 1, litres: 75 }] },
  { row: 281, serial: '4105125', sources: [{ name: 'Novotel New Plymouth', bins: 1, litres: 75 }] },
  { row: 282, serial: '4105127', sources: [{ name: 'Novotel New Plymouth', bins: 1, litres: 75 }, { name: 'Butlers Reef', bins: 1, litres: 60 }] },
  { row: 283, serial: '4102845', sources: [{ name: 'Juno Gin', bins: 1, litres: 30 }, { name: 'Molly Ryan Arvida', bins: 1, litres: 60 }] },
  { row: 284, serial: '4105134', sources: [{ name: 'Quails Nest Eatery', bins: 1, litres: 60 }] },
];

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID;
    if (!spreadsheetId) return json({ error: 'MATURING_BINS_SPREADSHEET_ID not set' }, 500);
    const sheets = getGoogleSheetsClient();

    const first = FIXES[0].row, last = FIXES[FIXES.length - 1].row;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A${first}:N${last}` });
    const rows = res.data.values ?? [];

    const plan: { row: number; status: string; write?: { range: string; values: string[][] }[] }[] = [];
    for (const f of FIXES) {
      const r = rows[f.row - first] ?? [];
      const date = String(r[0] ?? '').trim();
      const serial = String(r[6] ?? '').trim();
      const note = String(r[11] ?? '');
      if (date !== DATE || (serial !== f.serial && serial !== f.newSerial)) {
        plan.push({ row: f.row, status: `SKIPPED: expected ${DATE} / ${f.serial}, found ${date} / ${serial}` });
        continue;
      }
      if (note.includes(NOTE_SUFFIX.trim())) {
        plan.push({ row: f.row, status: 'already corrected' });
        continue;
      }
      const names = [...new Set(f.sources.map((s) => s.name))];
      const breakdown = f.sources.map((s) => ({ name: s.name, bins: s.bins ?? 0, buckets: s.buckets ?? 0, litres: s.litres }));
      plan.push({
        row: f.row,
        status: 'will correct',
        write: [
          { range: `'${TAB}'!B${f.row}:G${f.row}`, values: [[names[0] ?? '', names[1] ?? '', names[2] ?? '', names[3] ?? '', names[4] ?? '', f.newSerial ?? serial]] },
          { range: `'${TAB}'!L${f.row}:N${f.row}`, values: [[note.trimEnd() + NOTE_SUFFIX, names.slice(5).join(', '), JSON.stringify(breakdown)]] },
        ],
      });
    }

    const data = plan.flatMap((p) => p.write ?? []);
    if (!dryRun && data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data }, // same as maturing-bins-write, so the serial is stored like every other
      });
    }
    return json({ dryRun, written: dryRun ? 0 : plan.filter((p) => p.write).length, plan });
  } catch (error) {
    console.error('maturing-bins-fix-20aug failed', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
