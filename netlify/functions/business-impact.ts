import type { Context } from '@netlify/functions';
import {
  getSheetsClient, readSettingsRows, parseSettings, findByCode,
} from './_lib/impact-settings';
import { computeImpact, attachPileStages } from './_lib/impact';

// PUBLIC endpoint — deliberately no bearer auth. The unguessable per-business
// link code is the access control. GET only, so CORS is opened for GET alone
// (the shared corsHeaders() also advertises POST, which we don't want here).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });
}

// Compost Monitor's Build Phases tab, via its unauthenticated read endpoint. Best effort only:
// any failure just means piles are shown without a stage.
const PHASES_URL = 'https://compostmonitor.netlify.app/.netlify/functions/compost-sheets-read?tab=Build%20Phases';

async function fetchPhaseRows(): Promise<(string | number)[][]> {
  try {
    const res = await fetch(PHASES_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    return Array.isArray(body.data) ? (body.data as (string | number)[][]) : [];
  } catch {
    return [];
  }
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const code = (new URL(request.url).searchParams.get('code') ?? '').trim();
  if (!code || code.length > 120) return json({ error: 'Not found' }, 404, { 'Cache-Control': 'no-store' });

  try {
    const invoicingId = process.env.GOOGLE_SPREADSHEET_ID;
    const binsId = process.env.MATURING_BINS_SPREADSHEET_ID;
    if (!invoicingId || !binsId) return json({ error: 'Server misconfigured' }, 500, { 'Cache-Control': 'no-store' });

    const sheets = getSheetsClient();
    const { rows: settingsRows } = await readSettingsRows(sheets, invoicingId);
    const setting = findByCode(parseSettings(settingsRows), code);
    if (!setting) return json({ error: 'Not found' }, 404, { 'Cache-Control': 'no-store' });

    const [inv, bt, phases] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: invoicingId, range: 'invoicing' }),
      sheets.spreadsheets.values.get({ spreadsheetId: binsId, range: "'Bin Tracker'" }),
      fetchPhaseRows(),
    ]);

    const calc = computeImpact(
      (inv.data.values as (string | number)[][]) ?? [],
      (bt.data.values as (string | number)[][]) ?? [],
      setting,
      new Date(),
    );
    const report = phases.length ? attachPileStages(calc, phases) : calc;
    return json(report, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch (error) {
    console.error('business-impact failed:', error);
    return json({ error: 'Failed to build report' }, 500, { 'Cache-Control': 'no-store' });
  }
};
