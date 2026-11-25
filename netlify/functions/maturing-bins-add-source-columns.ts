import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-shot, idempotent header setup for the two columns added 2026-08-13.
//
// The Bin Tracker tab has only ever had five "Content from" columns (B–F), so
// a maturing bin fed by 6+ businesses lost the rest on write, and the compost
// monitor had to guess each source's share with a positional 5:4:3:2:1
// weighting. Two columns fix both:
//
//   M: Content from 6+          — overflow business names
//   N: Source breakdown (JSON)  — [{name, bins, buckets, litres}, ...]
//
// They are APPENDED after the existing A–L (…, K batch, L notes) rather than
// inserted next to B–F on purpose. Both apps address this tab by column
// position, and inserting a column has broken it before: on 2026-04-21 two
// "Content from" columns were inserted between D and E, which shifted the bin
// serial from col E to col G and silently corrupted every collector
// submission until `maturing-bins-fix-columns.ts` backfilled them.
//
// Safe to re-run: existing header text is left alone.

const HEADERS: Record<string, string> = {
  M1: 'Content from 6+',
  N1: 'Source breakdown (JSON)',
};

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

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
      range: 'Bin Tracker!A1:N1',
    });
    const headerRow = read.data.values?.[0] || [];

    const existing = {
      M1: (headerRow[12] || '').toString().trim(),
      N1: (headerRow[13] || '').toString().trim(),
    };

    const toWrite = Object.entries(HEADERS).filter(
      ([cell]) => !existing[cell as keyof typeof existing]
    );

    if (toWrite.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Headers already present — nothing to do',
        existing,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        wouldWrite: Object.fromEntries(toWrite),
        existing,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: toWrite.map(([cell, value]) => ({
          range: `Bin Tracker!${cell}`,
          values: [[value]],
        })),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      written: Object.fromEntries(toWrite),
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error adding source columns:', error);
    return new Response(JSON.stringify({
      error: 'Failed to add source columns',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
