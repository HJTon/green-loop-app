import type { sheets_v4 } from 'googleapis';

// Chaffed-pickle highlighting on the Bin Tracker.
//
// Sometimes the collector refills a client's bokashi with chaffed pickle instead of the usual
// Zing mix. Those refills are only recorded as free text in the invoicing spreadsheet's
// "Pickup Notes" tab ("Chaff refill", "Chaff topup", "Full not z" ...). Every bin that later
// comes in from that client carries chaff, so its "Content from" cell for that client is shaded
// blue on the Bin Tracker.
//
// Rule (agreed with Joe 2026-11-25), per client:
//   - blue starts with bins collected AFTER a chaff refill visit (the bin taken away on the
//     chaff visit itself was filled with the old mix);
//   - it carries on through the visit where Zing is refilled again (that bin is still chaff),
//     and through the first collection after it (leftover chaff), then stops;
//   - a later chaff refill starts it again.
//
// Only the client's own name cell (B–F, or M for 6+ sources) is shaded, so the batch colours in
// G/K are untouched and a mixed bin shows which contributor brought the chaff. Cells that are
// shaded exactly CHAFF_BLUE but no longer qualify are reset to white, so the sync is idempotent
// and cleans up after row inserts that inherit a fill.

export const CHAFF_BLUE = { red: 0x9f / 255, green: 0xc5 / 255, blue: 0xe8 / 255 }; // #9fc5e8
const WHITE = { red: 1, green: 1, blue: 1 };

const PICKUP_NOTES_TAB = 'Pickup Notes';
const BIN_TRACKER_TAB = 'Bin Tracker';
// 0-based columns on Bin Tracker holding source names: B–F and M ("Content from 6+").
const NAME_COLS = [1, 2, 3, 4, 5, 12];

export type RefillKind = 'chaff' | 'zing';

/** Reads a pickup note as a chaff refill, a regular Zing refill, or neither. */
export function classifyRefillNote(note: string): RefillKind | null {
  const n = note || '';
  // "not z" = topped up with something other than Zing, which is the chaff.
  if (/chaf|\bnot\s*z\b/i.test(n)) return 'chaff';
  if (/\bz(ing|ng)?\b|zing|bokashi|bukashi/i.test(n)) return 'zing';
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Day number (UTC ms) for "2026-10-15" or "15-Oct-2026" / "15-Sept-2026"; null otherwise. */
export function parseDay(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mo === -1 ? null : Date.UTC(+m[3], mo, +m[1]);
  }
  return null;
}

const key = (name: string) => name.trim().toLowerCase();

export interface RefillEvent { day: number; client: string; kind: RefillKind }
export interface TrackerRow { row: number; day: number | null; names: { col: number; name: string }[] }

/** Returns "row:col" (0-based) for every name cell that should be blue. */
export function computeChaffCells(events: RefillEvent[], rows: TrackerRow[]): Set<string> {
  const byClient = new Map<string, RefillEvent[]>();
  for (const e of events) {
    const k = key(e.client);
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k)!.push(e);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.day - b.day);

  // Every collection day per client, to find "the first collection after the Zing visit".
  const binDays = new Map<string, number[]>();
  for (const r of rows) {
    if (r.day === null) continue;
    for (const { name } of r.names) {
      const k = key(name);
      if (!byClient.has(k)) continue;
      if (!binDays.has(k)) binDays.set(k, []);
      binDays.get(k)!.push(r.day);
    }
  }
  for (const d of binDays.values()) d.sort((a, b) => a - b);

  const isChaffBin = (k: string, day: number): boolean => {
    const evs = byClient.get(k);
    if (!evs) return false;
    let lastChaff: RefillEvent | undefined;
    for (const e of evs) if (e.kind === 'chaff' && e.day < day) lastChaff = e;
    if (!lastChaff) return false;
    const zing = evs.find((e) => e.kind === 'zing' && e.day > lastChaff!.day);
    if (!zing || zing.day >= day) return true; // still on chaff, or collected at the Zing visit
    const firstAfterZing = binDays.get(k)?.find((d) => d > zing.day);
    return firstAfterZing === day;
  };

  const out = new Set<string>();
  for (const r of rows) {
    if (r.day === null) continue;
    for (const { col, name } of r.names) if (isChaffBin(key(name), r.day)) out.add(`${r.row}:${col}`);
  }
  return out;
}

const close = (a: number | null | undefined, b: number) => Math.abs((a ?? 0) - b) < 0.01;
const isChaffBlue = (c?: sheets_v4.Schema$Color | null) =>
  !!c && close(c.red, CHAFF_BLUE.red) && close(c.green, CHAFF_BLUE.green) && close(c.blue, CHAFF_BLUE.blue);

export interface ChaffSyncResult {
  chaffEvents: number;
  zingEvents: number;
  highlighted: { row: number; name: string; date: string }[]; // newly shaded (1-based row)
  cleared: { row: number; name: string }[];
  totalBlue: number;
}

/** Recomputes the chaff highlights on the Bin Tracker and applies only the differences. */
export async function syncChaffHighlights(sheets: sheets_v4.Sheets, dryRun = false): Promise<ChaffSyncResult> {
  const invoicingId = process.env.GOOGLE_SPREADSHEET_ID;
  const maturingId = process.env.MATURING_BINS_SPREADSHEET_ID;
  if (!invoicingId || !maturingId) throw new Error('spreadsheet ids not configured');

  const notes = await sheets.spreadsheets.values.get({ spreadsheetId: invoicingId, range: `'${PICKUP_NOTES_TAB}'!A2:G` });
  const events: RefillEvent[] = [];
  for (const r of (notes.data.values ?? []) as string[][]) {
    const day = parseDay(r[0]);
    const kind = classifyRefillNote(r[6] ?? '');
    if (day !== null && kind && r[2]) events.push({ day, client: r[2], kind });
  }

  const res = await sheets.spreadsheets.get({
    spreadsheetId: maturingId,
    ranges: [`'${BIN_TRACKER_TAB}'!A1:M`],
    fields: 'sheets(properties(sheetId),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))',
  });
  const sheet = res.data.sheets?.[0];
  const tabId = sheet?.properties?.sheetId;
  if (tabId === undefined || tabId === null) throw new Error(`Tab "${BIN_TRACKER_TAB}" not found`);
  const rowData = sheet?.data?.[0]?.rowData ?? [];

  const rows: TrackerRow[] = rowData.map((rd, i) => {
    const v = rd.values ?? [];
    return {
      row: i,
      day: i === 0 ? null : parseDay(v[0]?.formattedValue),
      names: NAME_COLS.map((col) => ({ col, name: (v[col]?.formattedValue ?? '').trim() })).filter((x) => x.name),
    };
  });

  const want = computeChaffCells(events, rows);
  const result: ChaffSyncResult = {
    chaffEvents: events.filter((e) => e.kind === 'chaff').length,
    zingEvents: events.filter((e) => e.kind === 'zing').length,
    highlighted: [],
    cleared: [],
    totalBlue: want.size,
  };
  const requests: sheets_v4.Schema$Request[] = [];
  const paint = (row: number, col: number, color: sheets_v4.Schema$Color) =>
    requests.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { backgroundColor: color } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });

  rowData.forEach((rd, row) => {
    if (row === 0) return;
    const v = rd.values ?? [];
    for (const col of NAME_COLS) {
      const cell = v[col];
      const blue = isChaffBlue(cell?.effectiveFormat?.backgroundColor);
      const should = want.has(`${row}:${col}`);
      if (should && !blue) {
        paint(row, col, CHAFF_BLUE);
        result.highlighted.push({ row: row + 1, name: cell?.formattedValue ?? '', date: v[0]?.formattedValue ?? '' });
      } else if (!should && blue) {
        paint(row, col, WHITE);
        result.cleared.push({ row: row + 1, name: cell?.formattedValue ?? '' });
      }
    }
  });

  if (!dryRun && requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: maturingId, requestBody: { requests } });
  }
  return result;
}
