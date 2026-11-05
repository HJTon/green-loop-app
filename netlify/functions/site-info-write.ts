import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// Upsert a row in the "Site Info" tab (created on first write), keyed by
// business name. Columns: A Business Name | B Find Instructions | C Media URLs | D Approach Note
const TAB_NAME = 'Site Info';
const HEADER = ['Business Name', 'Find Instructions', 'Media URLs', 'Approach Note'];

interface WriteRequest {
  businessName: string;
  instructions?: string;
  media?: string[];
  approach_from?: string;
}

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

type Sheets = ReturnType<typeof getGoogleSheetsClient>;

// Make sure the Site Info tab exists with a header row; create it if missing.
async function ensureTab(sheets: Sheets, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(s => s.properties?.title === TAB_NAME);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB_NAME}!A1:D1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const body: WriteRequest = await request.json();
    const businessName = (body.businessName || '').trim();
    if (!businessName) {
      return new Response(JSON.stringify({ error: 'Missing businessName' }), {
        status: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const instructions = body.instructions || '';
    const media = (body.media || []).join('\n');
    const approach_from = body.approach_from || '';

    const sheets = getGoogleSheetsClient();
    await ensureTab(sheets, spreadsheetId);

    // Find an existing row for this business (case-insensitive match on col A).
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB_NAME}!A:A`,
    });
    const colA = (existing.data.values as string[][]) || [];
    const key = businessName.toLowerCase();
    let rowIndex = -1; // 1-indexed sheet row
    for (let i = 0; i < colA.length; i++) {
      if ((colA[i]?.[0] || '').trim().toLowerCase() === key) {
        rowIndex = i + 1;
        break;
      }
    }

    const rowValues = [businessName, instructions, media, approach_from];

    if (rowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TAB_NAME}!A${rowIndex}:D${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowValues] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${TAB_NAME}!A:D`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues] },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error writing Site Info:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write Site Info',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
