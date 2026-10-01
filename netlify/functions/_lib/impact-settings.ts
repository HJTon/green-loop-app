// Google Sheets I/O for the "Impact Reports" settings tab in the invoicing
// spreadsheet. Shared by impact-sync, impact-sync-daily and business-impact.
//
// Tab layout (row 1 headers):
//   A Business (exact invoicing name) | B Link code | C Kg per full 120L bin
//   D Other names in Bin Tracker (comma-separated) | E Report link | F Notes
//   G Year starts (month name or 1-12; blank = January)

import { randomInt } from 'node:crypto';
import { google, type sheets_v4 } from 'googleapis';
import { listInvoicingBusinesses, norm, SEED_ALIASES, type ImpactSettings } from './impact';

export { SEED_ALIASES };

export const SETTINGS_TAB = 'Impact Reports';
export const REPORT_BASE_URL = 'https://compostmonitor.netlify.app/impact/';
export const HEADERS = [
  'Business',
  'Link code',
  'Kg per full 120L bin (blank = 70)',
  'Other names in Bin Tracker (comma-separated)',
  'Report link',
  'Notes',
  'Year starts (month, blank = January)',
];

export function getSheetsClient(): sheets_v4.Sheets {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

type Row = (string | number | null | undefined)[];

export interface SettingsRow extends ImpactSettings {
  code: string;
  rowNumber: number; // 1-based
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function generateCode(name: string): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALNUM[randomInt(ALNUM.length)];
  return `${slugify(name)}-${suffix}`;
}

async function tabExists(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<boolean> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  return (meta.data.sheets ?? []).some((s) => s.properties?.title === SETTINGS_TAB);
}

/** Reads the settings tab. Returns [] if the tab does not exist. */
export async function readSettingsRows(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<{ rows: Row[]; exists: boolean }> {
  if (!(await tabExists(sheets, spreadsheetId))) return { rows: [], exists: false };
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SETTINGS_TAB}'!A1:G`,
  });
  return { rows: (res.data.values as Row[]) ?? [], exists: true };
}

export function parseSettings(rows: Row[]): SettingsRow[] {
  const out: SettingsRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const business = String(r[0] ?? '').trim();
    const code = String(r[1] ?? '').trim();
    if (!business || !code) continue;
    const kg = parseFloat(String(r[2] ?? '').trim());
    out.push({
      business,
      code,
      rowNumber: i + 1,
      kgPerFullBin: Number.isFinite(kg) && kg > 0 ? kg : null,
      aliases: String(r[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      yearStartMonth: parseMonth(r[6]),
    });
  }
  return out;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** 'April', 'apr', '4' -> 4; blank/unknown -> null (January). */
export function parseMonth(v: unknown): number | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  const i = MONTH_NAMES.indexOf(s.slice(0, 3));
  return i >= 0 ? i + 1 : null;
}

export function findByCode(settings: SettingsRow[], code: string): SettingsRow | undefined {
  const want = code.trim().toLowerCase();
  if (!want) return undefined;
  return settings.find((s) => s.code.toLowerCase() === want);
}

export interface SyncWrite { range: string; values: string[][] }
export interface SyncPlan {
  tabCreated: boolean;
  writes: SyncWrite[];
  added: { business: string; code: string; link: string }[];
  filled: { business: string; what: string }[];
}

/**
 * Pure planning step: given the current settings rows and the invoicing
 * business list, decide what to write. Never overwrites a non-blank cell and
 * never touches C/D/F/G of existing rows.
 */
export function planSync(existing: Row[], businesses: string[], genCode: (name: string) => string = generateCode): SyncPlan {
  const writes: SyncWrite[] = [];
  const added: SyncPlan['added'] = [];
  const filled: SyncPlan['filled'] = [];
  const q = `'${SETTINGS_TAB}'`;

  // Headers
  const h = existing[0] ?? [];
  for (let c = 0; c < HEADERS.length; c++) {
    if (!String(h[c] ?? '').trim()) {
      const col = String.fromCharCode(65 + c);
      writes.push({ range: `${q}!${col}1`, values: [[HEADERS[c]]] });
    }
  }

  const usedCodes = new Set<string>();
  const listed = new Set<string>();
  let lastRow = 1; // 1-based index of last row holding anything
  for (let i = 1; i < existing.length; i++) {
    const r = existing[i] ?? [];
    if (r.some((v) => String(v ?? '').trim())) lastRow = i + 1;
    const code = String(r[1] ?? '').trim();
    if (code) usedCodes.add(code.toLowerCase());
    const name = String(r[0] ?? '').trim();
    if (name) listed.add(norm(name));
  }

  // Fill blank B / E for rows that already exist
  for (let i = 1; i < existing.length; i++) {
    const r = existing[i] ?? [];
    const name = String(r[0] ?? '').trim();
    if (!name) continue;
    let code = String(r[1] ?? '').trim();
    const rowNum = i + 1;
    if (!code) {
      do { code = genCode(name); } while (usedCodes.has(code.toLowerCase()));
      usedCodes.add(code.toLowerCase());
      writes.push({ range: `${q}!B${rowNum}`, values: [[code]] });
      filled.push({ business: name, what: 'code' });
    }
    if (!String(r[4] ?? '').trim()) {
      writes.push({ range: `${q}!E${rowNum}`, values: [[REPORT_BASE_URL + code]] });
      filled.push({ business: name, what: 'link' });
    }
  }

  // New businesses go on rows after the last used row
  let next = lastRow + 1;
  for (const b of businesses) {
    if (listed.has(norm(b))) continue;
    listed.add(norm(b));
    let code: string;
    do { code = genCode(b); } while (usedCodes.has(code.toLowerCase()));
    usedCodes.add(code.toLowerCase());
    const link = REPORT_BASE_URL + code;
    const aliases = (SEED_ALIASES[norm(b)] ?? []).join(', ');
    writes.push({ range: `${q}!A${next}:G${next}`, values: [[b, code, '', aliases, link, '', '']] });
    added.push({ business: b, code, link });
    next++;
  }

  return { tabCreated: false, writes, added, filled };
}

async function addTab(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: SETTINGS_TAB } } }] },
  });
}

/** Reads invoicing + settings, plans (and unless dryRun, applies) the sync. */
export async function runImpactSync(dryRun: boolean): Promise<SyncPlan> {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID not configured');
  const sheets = getSheetsClient();

  const inv = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'invoicing' });
  const businesses = listInvoicingBusinesses((inv.data.values as Row[]) ?? []);

  const { rows, exists } = await readSettingsRows(sheets, spreadsheetId);
  const plan = planSync(rows, businesses);
  plan.tabCreated = !exists;

  if (dryRun || plan.writes.length === 0) return plan;

  if (!exists) await addTab(sheets, spreadsheetId);
  // Explicit-range updates only (never values.append).
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: plan.writes.map((w) => ({ range: w.range, values: w.values })),
    },
  });
  return plan;
}
