import type { sheets_v4 } from 'googleapis';

// Chaffed-pickle highlighting on the Bin Tracker.
//
// Sometimes the collector refills a client's bokashi with chaffed pickle instead of the usual
// Zing mix. Those refills are only recorded as free text in the invoicing spreadsheet's
// "Pickup Notes" tab ("Chaff refill", "Chaff topup", "Full not z" ...). Every bin that later
// comes in from that client carries chaff, so it is highlighted on the Bin Tracker.
//
// Rule (agreed with Joe 2026-11-25, revised the same day), per client — a bin carries whatever
// mix the client had in their bucket while filling it:
//   - CP starts with bins collected AFTER a chaff refill visit (the bin taken away on the
//     chaff visit itself was filled with the old mix);
//   - it carries on through the visit where Zing is refilled again (that bin is still chaff),
//     and stops there: bins collected after the Zing visit are normal;
//   - a later chaff refill starts it again.
//
// Colours (changed 2026-11-25 from a blue name cell):
//   - the chaff client's own name cell (B–F, or M for 6+ sources) is CP_BRIGHT yellow;
//   - every other cell of that row, A–O, is CP_LIGHT yellow.
// Only cells that are white/unfilled or already one of OUR colours are painted, so the batch
// colours in G/K and anything highlighted by hand are never overwritten. Cells in one of our
// colours that no longer qualify are reset to white, so the sync is idempotent and cleans up after
// row inserts that inherit a fill.
//
// The compost monitor's bin scanner reads CP_BRIGHT name cells to say "contains some CP" — keep
// compost-monitor/netlify/functions/compost-sheets-read.ts in step if these values change. They
// are deliberately not stock palette yellows (#ffff00 / #fff2cc are already used by hand).

export const CP_BRIGHT = { red: 0xff / 255, green: 0xe6 / 255, blue: 0x00 / 255 }; // #ffe600
export const CP_LIGHT = { red: 0xff / 255, green: 0xf6 / 255, blue: 0xc2 / 255 }; // #fff6c2
const LEGACY_BLUE = { red: 0x9f / 255, green: 0xc5 / 255, blue: 0xe8 / 255 }; // #9fc5e8, first version
const WHITE = { red: 1, green: 1, blue: 1 };

const PICKUP_NOTES_TAB = 'Pickup Notes';
const BIN_TRACKER_TAB = 'Bin Tracker';
// 0-based columns on Bin Tracker holding source names: B–F and M ("Content from 6+").
const NAME_COLS = [1, 2, 3, 4, 5, 12];
const ROW_COLS = 15; // A–O

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

/** Returns "row:col" (0-based) for every name cell that carries chaffed pickle. */
export function computeChaffCells(events: RefillEvent[], rows: TrackerRow[]): Set<string> {
  const byClient = new Map<string, RefillEvent[]>();
  for (const e of events) {
    const k = key(e.client);
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k)!.push(e);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.day - b.day);

  const isChaffBin = (k: string, day: number): boolean => {
    const evs = byClient.get(k);
    if (!evs) return false;
    let lastChaff: RefillEvent | undefined;
    for (const e of evs) if (e.kind === 'chaff' && e.day < day) lastChaff = e;
    if (!lastChaff) return false;
    const zing = evs.find((e) => e.kind === 'zing' && e.day > lastChaff!.day);
    // Still on chaff, or this bin was collected AT the Zing visit (filled before the refill).
    return !zing || zing.day >= day;
  };

  const out = new Set<string>();
  for (const r of rows) {
    if (r.day === null) continue;
    for (const { col, name } of r.names) if (isChaffBin(key(name), r.day)) out.add(`${r.row}:${col}`);
  }
  return out;
}

// Exact match to 1/255 — our yellows sit close to hand-used ones (#fff2cc), so be strict.
const close = (a: number | null | undefined, b: number) => Math.abs((a ?? 0) - b) < 0.003;
const same = (c: sheets_v4.Schema$Color | null | undefined, ref: { red: number; green: number; blue: number }) =>
  !!c && close(c.red, ref.red) && close(c.green, ref.green) && close(c.blue, ref.blue);
// No backgroundColor at all = unfilled. (An empty object is black: the API omits zero channels.)
const isWhite = (c?: sheets_v4.Schema$Color | null) => !c || same(c, WHITE);

type Paint = 'bright' | 'light' | 'none';
const COLOURS: Record<Paint, { red: number; green: number; blue: number }> = { bright: CP_BRIGHT, light: CP_LIGHT, none: WHITE };
function currentPaint(c?: sheets_v4.Schema$Color | null): Paint | 'ours-legacy' | 'foreign' {
  if (same(c, CP_BRIGHT)) return 'bright';
  if (same(c, CP_LIGHT)) return 'light';
  if (same(c, LEGACY_BLUE)) return 'ours-legacy';
  return isWhite(c) ? 'none' : 'foreign';
}

export interface ChaffSyncResult {
  chaffEvents: number;
  zingEvents: number;
  cpRows: number; // rows that carry chaff
  cpCells: number; // bright-yellow name cells
  highlighted: { row: number; name: string; date: string }[]; // name cells newly made bright (1-based row)
  cellsPainted: number; // every cell changed this run, incl. light row fill and clears
  cleared: number; // cells reset to white
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
    ranges: [`'${BIN_TRACKER_TAB}'!A1:O`],
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
  const cpRowSet = new Set([...want].map((k) => Number(k.split(':')[0])));
  const result: ChaffSyncResult = {
    chaffEvents: events.filter((e) => e.kind === 'chaff').length,
    zingEvents: events.filter((e) => e.kind === 'zing').length,
    cpRows: cpRowSet.size,
    cpCells: want.size,
    highlighted: [],
    cellsPainted: 0,
    cleared: 0,
  };
  const requests: sheets_v4.Schema$Request[] = [];
  const paint = (row: number, col: number, p: Paint) => {
    result.cellsPainted++;
    if (p === 'none') result.cleared++;
    requests.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { backgroundColor: COLOURS[p] } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  };

  rowData.forEach((rd, row) => {
    if (row === 0) return;
    const v = rd.values ?? [];
    const isCpRow = cpRowSet.has(row);
    for (let col = 0; col < ROW_COLS; col++) {
      const cell = v[col];
      const now = currentPaint(cell?.effectiveFormat?.backgroundColor);
      if (now === 'foreign') continue; // batch colour or a hand highlight: never touch
      const target: Paint = want.has(`${row}:${col}`) ? 'bright' : isCpRow ? 'light' : 'none';
      if (now === target) continue;
      paint(row, col, target);
      if (target === 'bright') {
        result.highlighted.push({ row: row + 1, name: cell?.formattedValue ?? '', date: v[0]?.formattedValue ?? '' });
      }
    }
  });

  if (!dryRun && requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: maturingId, requestBody: { requests } });
  }
  return result;
}
