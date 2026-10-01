import type { Context } from '@netlify/functions';
import type { sheets_v4 } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';
import { getSheetsClient } from './_lib/impact-settings';
import { BUSINESS_LIST_TAB, syncBusinessList } from './_lib/business-list';

// One-shot, idempotent tidy of the Bin Tracker tab (agreed with Joe 2-Oct-2026). Supports ?dryRun=1.
//
//  1. Text dates → real dates in A (collection) and J (batching). The apps wrote September as
//     "3-Sept-2026", which Sheets can't parse, so those cells were text and the Date of Maturation
//     formula in I showed #VALUE!. The writers now emit "Sep"; this converts what's already there.
//  2. One date format (d-mmm-yyyy) for A, I and J — rows had been formatted three different ways.
//  3. Business-name variants in B–F → current names (e.g. "Columbus" → "Columbus Coffee"). Bin numbers
//     typed into a name ("Lifeskills 4102749") move into the Notes column.
//  4. Dropdowns: the accidental ones on E, F (stale 7-name lists, strict) and N (the app's JSON column)
//     are removed. B–F get one shared, warn-only dropdown fed by the hidden "Business List" tab.
//     H (colour) keeps its list but warns instead of rejecting.
//  5. Header row: trailing spaces trimmed, bold, frozen. Columns are read by position, never by name.
//
// Nothing here touches G (serials), K (pile names) or N's values: those need Joe's input first.

const TAB = 'Bin Tracker';
const DATE_FORMAT = 'd-mmm-yyyy';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const RENAME: Record<string, string> = {
  'columbus': 'Columbus Coffee',
  'novotel': 'Novotel New Plymouth',
  'toi foundation': 'TOI Foundation',
  'food bank': 'NP Community Foodbank Trust',
  'molly ryan': 'Molly Ryan Arvida',
  'tsb bank ltd': 'TSB Bank Ltd - Call Centre and Branch',
  'top 10 park': 'New Plymouth Top 10 Holiday Park',
  'mitre10 st aubyn st': 'Mitre 10 St Aubyn St',
  'junction': 'The Junction Zero Waste Hub',
};
/** "Lifeskills 4102749" / "Ngamutu House #4105262": a name with a bin number typed after it. */
const NAME_WITH_SERIAL = /^(.*?)\s*#?(\d{7})$/;
const NAME_FIX: Record<string, string> = { 'lifeskills': 'Life Skills', 'life skills': 'Life Skills', 'ngamutu house': 'Ngamutu House' };

function textDateToSheet(v: unknown): string | null {
  if (typeof v !== 'string') return null; // numbers are already real dates
  const m = /^\s*(\d{1,2})-([A-Za-z]{3,})-(\d{4})\s*$/.exec(v);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mi < 0) return null;
  return `${Number(m[1])}-${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)}-${m[3]}`;
}

function cleanName(raw: string): { name: string; serial?: string } {
  const t = raw.trim();
  const ser = NAME_WITH_SERIAL.exec(t);
  if (ser && ser[1]) {
    const base = ser[1].trim();
    return { name: NAME_FIX[base.toLowerCase()] ?? base, serial: ser[2] };
  }
  return { name: RENAME[t.toLowerCase()] ?? t };
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID!;
    const sheets = getSheetsClient();

    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties))' });
    const props = meta.data.sheets?.find((s) => s.properties?.title === TAB)?.properties;
    if (props?.sheetId == null) return json({ error: `${TAB} not found` }, 500);
    const sheetId = props.sheetId;
    const gridRows = props.gridProperties?.rowCount ?? 1000;

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A1:N${gridRows}`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const rows = (res.data.values ?? []) as unknown[][];

    const writes: sheets_v4.Schema$ValueRange[] = [];
    const dateFixes: string[] = [];
    const nameFixes: string[] = [];
    const seenNames = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const rowNo = i + 1;
      for (const [col, idx] of [['A', 0], ['J', 9]] as const) {
        const fixed = textDateToSheet(r[idx]);
        if (fixed) { writes.push({ range: `'${TAB}'!${col}${rowNo}`, values: [[fixed]] }); dateFixes.push(`${col}${rowNo}: ${String(r[idx])} → ${fixed}`); }
      }
      const before = [1, 2, 3, 4, 5].map((c) => String(r[c] ?? '').trim());
      const serials: string[] = [];
      const after: string[] = [];
      for (const n of before) {
        if (!n) continue;
        const c = cleanName(n);
        if (c.serial) serials.push(`${c.name} bin ${c.serial}`);
        if (!after.some((a) => a.toLowerCase() === c.name.toLowerCase())) after.push(c.name);
      }
      after.forEach((n) => seenNames.add(n));
      const padded = [...after, '', '', '', '', ''].slice(0, 5);
      if (padded.join('|') !== before.join('|')) {
        writes.push({ range: `'${TAB}'!B${rowNo}:F${rowNo}`, values: [padded] });
        nameFixes.push(`row ${rowNo}: ${before.filter(Boolean).join(' / ')} → ${after.join(' / ')}`);
        if (serials.length) {
          const note = String(r[11] ?? '').trim();
          const add = serials.filter((s) => !note.includes(s)).join('; ');
          if (add) writes.push({ range: `'${TAB}'!L${rowNo}`, values: [[note ? `${note}; ${add}` : add]] });
        }
      }
    }

    const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
    const headerChanged = header.join('|') !== (rows[0] ?? []).map((h) => String(h ?? '')).join('|');

    const list = await syncBusinessList(sheets, [...seenNames], dryRun);
    if (dryRun) {
      return json({ dryRun, dateFixes: dateFixes.length, dateSamples: dateFixes.slice(0, 8), nameFixes, headerChanged, businessList: list });
    }

    if (headerChanged) writes.push({ range: `'${TAB}'!A1:N1`, values: [header.slice(0, 14)] });
    if (writes.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: writes } });
    }

    const col = (c: number, c2 = c + 1) => ({ sheetId, startRowIndex: 1, endRowIndex: gridRows, startColumnIndex: c, endColumnIndex: c2 });
    const dateFmt = (c: number): sheets_v4.Schema$Request => ({
      repeatCell: { range: col(c), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: DATE_FORMAT } } }, fields: 'userEnteredFormat.numberFormat' },
    });
    const requests: sheets_v4.Schema$Request[] = [
      // Clear every rule on B–F and N, then set the shared business dropdown on B–F.
      { setDataValidation: { range: col(1, 6) } },
      { setDataValidation: { range: col(13) } },
      {
        setDataValidation: {
          range: col(1, 6),
          rule: {
            condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${BUSINESS_LIST_TAB}'!$A$2:$A` }] },
            strict: false,
            showCustomUi: true,
          },
        },
      },
      {
        setDataValidation: {
          range: col(7),
          rule: {
            condition: { type: 'ONE_OF_LIST', values: ['red', 'yellow', 'blue', 'red tag', 'green tag', 'Black tag'].map((v) => ({ userEnteredValue: v })) },
            strict: false,
            showCustomUi: true,
          },
        },
      },
      dateFmt(0), dateFmt(8), dateFmt(9),
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 14 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ];
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

    return json({ dryRun, dateFixes: dateFixes.length, nameFixes: nameFixes.length, headerChanged, valueWrites: writes.length, businessList: { created: list.created, added: list.added.length, total: list.names.length } });
  } catch (e) {
    console.error('maturing-bins-tidy failed', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};
