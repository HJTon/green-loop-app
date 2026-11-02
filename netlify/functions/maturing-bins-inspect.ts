import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// Read-only diagnostics for the maturing-bins spreadsheet: tabs, and for one tab
// (default "Bin Tracker") the dropdown / validation rules, number formats, formulas,
// conditional formats and column widths, summarised per column. Writes nothing.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return google.sheets({ version: 'v4', auth });
}

const colName = (i: number) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
  try {
    const url = new URL(request.url);
    const tab = url.searchParams.get('tab') || 'Bin Tracker';
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID!;
    const sheets = getGoogleSheetsClient();

    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.title,sheets(properties(title,gridProperties,hidden))',
    });
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${tab}'`],
      fields: 'sheets(properties(title,gridProperties),conditionalFormats,bandedRanges,merges,basicFilter,protectedRanges(range,description),data(columnMetadata(pixelSize,hiddenByUser),rowData(values(dataValidation,userEnteredValue(formulaValue),effectiveValue,effectiveFormat(numberFormat,backgroundColor)))))',
    });
    const sh = res.data.sheets?.[0];
    const data = sh?.data?.[0];
    const rows = data?.rowData ?? [];

    const cols: Record<string, {
      width?: number | null; hidden?: boolean | null;
      validation: Record<string, number>; formats: Record<string, number>; formulas: Record<string, number>;
      valueTypes: Record<string, number>; backgrounds: Record<string, number>;
    }> = {};
    const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
    rows.forEach((row, ri) => {
      (row.values ?? []).forEach((c, ci) => {
        const k = colName(ci);
        cols[k] ??= { width: data?.columnMetadata?.[ci]?.pixelSize, hidden: data?.columnMetadata?.[ci]?.hiddenByUser, validation: {}, formats: {}, formulas: {}, valueTypes: {}, backgrounds: {} };
        if (ri === 0) return; // header
        const v = c.dataValidation;
        if (v) {
          const vals = (v.condition?.values ?? []).map((x) => x.userEnteredValue).join('|');
          bump(cols[k].validation, `${v.condition?.type}${vals ? ': ' + vals.slice(0, 200) : ''}${v.strict ? ' (strict)' : ''}`);
        }
        const nf = c.effectiveFormat?.numberFormat;
        if (nf) bump(cols[k].formats, `${nf.type}${nf.pattern ? ' ' + nf.pattern : ''}`);
        const f = c.userEnteredValue?.formulaValue;
        if (f) bump(cols[k].formulas, f.replace(/\d+/g, 'n'));
        const ev = c.effectiveValue;
        if (ev) bump(cols[k].valueTypes, Object.keys(ev)[0]);
        const bg = c.effectiveFormat?.backgroundColor;
        if (bg && !(bg.red === 1 && bg.green === 1 && bg.blue === 1)) bump(cols[k].backgrounds, JSON.stringify(bg));
      });
    });

    return json({
      spreadsheet: meta.data.properties?.title,
      tabs: meta.data.sheets?.map((s) => ({ title: s.properties?.title, rows: s.properties?.gridProperties?.rowCount, cols: s.properties?.gridProperties?.columnCount, frozenRows: s.properties?.gridProperties?.frozenRowCount, hidden: s.properties?.hidden })),
      tab,
      header: rows[0]?.values?.map((c) => c.effectiveValue?.stringValue ?? '') ?? [],
      grid: sh?.properties?.gridProperties,
      basicFilter: sh?.basicFilter ? true : false,
      merges: sh?.merges?.length ?? 0,
      bandedRanges: sh?.bandedRanges?.length ?? 0,
      protectedRanges: sh?.protectedRanges ?? [],
      conditionalFormats: (sh?.conditionalFormats ?? []).map((cf) => ({ ranges: cf.ranges, rule: cf.booleanRule?.condition ?? cf.gradientRule ?? null })),
      columns: cols,
    });
  } catch (e) {
    console.error('maturing-bins-inspect failed', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
};
