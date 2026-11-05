import type { sheets_v4 } from 'googleapis';
import { listInvoicingBusinesses } from './impact';

// The Bin Tracker's "Content from" dropdown (B–F) reads its options from a hidden
// "Business List" tab in the maturing-bins spreadsheet. A dropdown can't point at another
// spreadsheet, so the invoicing businesses are copied here; impact-sync-daily keeps it current,
// which means a new customer shows up in the dropdown the day after they're added to invoicing.
//
// Names already in the list are never removed (old sources like "Hub collection" still appear in
// historical rows and should stay valid). The dropdown is warn-only, so anything can still be typed.

export const BUSINESS_LIST_TAB = 'Business List';

async function tabId(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const s = meta.data.sheets?.find((x) => x.properties?.title === title);
  return s?.properties?.sheetId ?? null;
}

/** Ensures the hidden tab exists and holds the union of its current names, `extra`, and the invoicing businesses. */
export async function syncBusinessList(
  sheets: sheets_v4.Sheets,
  extra: string[] = [],
  dryRun = false,
): Promise<{ created: boolean; added: string[]; names: string[] }> {
  const maturingId = process.env.MATURING_BINS_SPREADSHEET_ID;
  const invoicingId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!maturingId || !invoicingId) throw new Error('spreadsheet ids not configured');

  const inv = await sheets.spreadsheets.values.get({ spreadsheetId: invoicingId, range: 'invoicing' });
  const invoicing = listInvoicingBusinesses((inv.data.values ?? []) as (string | number)[][]);

  const created = (await tabId(sheets, maturingId, BUSINESS_LIST_TAB)) == null;
  let current: string[] = [];
  if (!created) {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: maturingId, range: `'${BUSINESS_LIST_TAB}'!A2:A` });
    current = (r.data.values ?? []).map((x) => String(x[0] ?? '').trim()).filter(Boolean);
  }
  const seen = new Set(current.map((n) => n.toLowerCase()));
  const added: string[] = [];
  for (const n of [...invoicing, ...extra].map((x) => x.trim()).filter((x) => x && x !== '?')) {
    if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); added.push(n); }
  }
  const names = [...current, ...added].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (dryRun || (!created && !added.length)) return { created, added, names };

  if (created) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: maturingId,
      requestBody: { requests: [{ addSheet: { properties: { title: BUSINESS_LIST_TAB, hidden: true, gridProperties: { rowCount: 500, columnCount: 2 } } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: maturingId,
    range: `'${BUSINESS_LIST_TAB}'!A1:A${names.length + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Business (feeds the Bin Tracker "Content from" dropdown; kept up to date daily)'], ...names.map((n) => [n])] },
  });
  return { created, added, names };
}
