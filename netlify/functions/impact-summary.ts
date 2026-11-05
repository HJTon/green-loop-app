import { timingSafeEqual } from 'node:crypto';
import { getSheetsClient, readSettingsRows, parseSettings } from './_lib/impact-settings';
import { computeImpact } from './_lib/impact';

// GET ?key=<IMPACT_SUMMARY_KEY>
// Every business's impact totals in one CSV, for the "Impact Reports" tab of the
// invoicing sheet (pulled in with IMPORTDATA, which can't send headers, hence the
// key in the URL). Reads the sheets ONCE for all businesses: calling
// business-impact once per business blew through the Sheets API per-minute quota.
// Figures come from the same computeImpact() as the public report pages.

function keyOk(given: string): boolean {
  const expected = process.env.IMPACT_SUMMARY_KEY ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SUMMARY_HEADERS = [
  'Business',
  'Link code',
  'Kg diverted',
  'CO2e avoided, Green Loop estimate (kg)',
  'CO2e avoided, official MfE factor (kg)',
  'Pickups',
  'First collection',
  'Latest collection',
  'Status',
];

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (request: Request) => {
  if (request.method !== 'GET') return text('error,Method not allowed', 405);
  if (!process.env.IMPACT_SUMMARY_KEY) return text('error,IMPACT_SUMMARY_KEY not set on the server', 500);
  const key = (new URL(request.url).searchParams.get('key') ?? '').trim();
  if (!keyOk(key)) return text('error,Unauthorised', 401);

  try {
    const invoicingId = process.env.GOOGLE_SPREADSHEET_ID;
    const binsId = process.env.MATURING_BINS_SPREADSHEET_ID;
    if (!invoicingId || !binsId) return text('error,Server misconfigured', 500);

    const sheets = getSheetsClient();
    const [{ rows: settingsRows }, inv, bt] = await Promise.all([
      readSettingsRows(sheets, invoicingId),
      sheets.spreadsheets.values.get({ spreadsheetId: invoicingId, range: 'invoicing' }),
      sheets.spreadsheets.values.get({ spreadsheetId: binsId, range: "'Bin Tracker'" }),
    ]);
    const invRows = (inv.data.values as (string | number)[][]) ?? [];
    const btRows = (bt.data.values as (string | number)[][]) ?? [];
    const today = new Date();

    const lines = [SUMMARY_HEADERS.map(csvCell).join(',')];
    for (const s of parseSettings(settingsRows)) {
      try {
        const r = computeImpact(invRows, btRows, s, today);
        // computeImpact fills co2eVsLandfillBokashiKg, but the MonthRow type doesn't declare it.
        const t = r.totals as typeof r.totals & { co2eVsLandfillBokashiKg?: number };
        lines.push([
          s.business, s.code, t.kg, t.co2eVsLandfillBokashiKg ?? t.co2eVsLandfillKg, t.co2eVsLandfillKg,
          t.pickups, r.firstCollection, r.latestCollection, 'ok',
        ].map(csvCell).join(','));
      } catch (e) {
        console.error(`impact-summary: ${s.business} failed`, e);
        lines.push([s.business, s.code, '', '', '', '', '', '', 'error'].map(csvCell).join(','));
      }
    }
    return text(lines.join('\n') + '\n', 200);
  } catch (error) {
    console.error('impact-summary failed:', error);
    return text('error,Failed to build summary', 500);
  }
};
