import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// The "Site Info" tab holds driver-editable per-site help, keyed by business name:
//   A: Business Name | B: Find Instructions | C: Media URLs (newline/comma separated)
const TAB_NAME = 'Site Info';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    let rows: string[][] = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: TAB_NAME,
      });
      rows = (response.data.values as string[][]) || [];
    } catch (err) {
      // Tab doesn't exist yet — that's fine, there's just no site info recorded.
      console.log('Site Info tab not found (returning empty):', err instanceof Error ? err.message : err);
      rows = [];
    }

    return new Response(JSON.stringify({ success: true, data: rows }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error reading Site Info:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read Site Info',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
