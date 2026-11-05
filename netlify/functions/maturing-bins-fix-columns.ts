import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-shot, idempotent backfill.
//
// On 2026-04-21 the Bin Tracker tab gained two extra "Content from" columns
// between old D and E, shifting Number from col E (index 4) to col G (index 6).
// `maturing-bins-write.ts` was not updated at the same time, so collector-app
// submissions from that date onward landed bin numbers in the new col E
// (a "Content from" column) with col G left blank.
//
// This function finds every row where:
//   - col G (index 6) is empty, AND
//   - col E (index 4) looks like a bin serial (4+ digits)
// and rewrites E:G as ["", "", <bin number>] — leaving any other columns
// (H+ colour / maturation / batch) untouched.
//
// Safe to re-run: rows that already have col G filled are ignored.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const BIN_SERIAL_RE = /^\d{4,}$/;

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
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Bin Tracker!A:L',
    });

    const rows = read.data.values || [];
    const fixes: Array<{ rowNumber: number; binNumber: string; before: unknown[] }> = [];

    // Skip header (row 1 -> index 0). Sheet rows are 1-indexed.
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const colE = (row[4] ?? '').toString().trim();
      const colF = (row[5] ?? '').toString().trim();
      const colG = (row[6] ?? '').toString().trim();

      if (colG !== '') continue;            // already in new format
      if (!BIN_SERIAL_RE.test(colE)) continue; // not a misplaced bin number
      if (colF !== '') continue;            // someone already started filling F — leave alone

      fixes.push({
        rowNumber: i + 1,
        binNumber: colE,
        before: row.slice(0, 12),
      });
    }

    if (fixes.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No rows needed fixing',
        scanned: rows.length - 1,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        scanned: rows.length - 1,
        wouldFix: fixes.length,
        rows: fixes,
      }, null, 2), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Batch update: rewrite E:G on each affected row to ["", "", binNumber].
    const data = fixes.map(f => ({
      range: `Bin Tracker!E${f.rowNumber}:G${f.rowNumber}`,
      values: [['', '', f.binNumber]],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      scanned: rows.length - 1,
      fixed: fixes.length,
      rows: fixes.map(f => ({ rowNumber: f.rowNumber, binNumber: f.binNumber })),
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('maturing-bins-fix-columns failed:', error);
    return new Response(JSON.stringify({
      error: 'Backfill failed',
      details: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
