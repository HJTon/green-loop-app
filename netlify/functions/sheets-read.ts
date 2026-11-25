import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// Initialize Google Sheets API with service account credentials
function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

export default async (request: Request, context: Context) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }

  const authFail = checkAuth(request);
  if (authFail) return authFail;

  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    const url = new URL(request.url);
    const render = url.searchParams.get('render');
    const tab = url.searchParams.get('tab') || 'invoicing';

    // Read the entire sheet (all columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: tab,
      valueRenderOption: render === 'formula' ? 'FORMULA' : undefined,
    });

    const rows = response.data.values || [];

    return new Response(JSON.stringify({
      success: true,
      data: rows,
      rowCount: rows.length,
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error reading sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read sheet',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
