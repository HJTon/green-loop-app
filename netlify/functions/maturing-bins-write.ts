import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

interface MaturingBinContent {
  id: string;
  pickupTileId: string;
  clientId: string;
  businessName: string;
  binsCount: number;
  collectionType: 'bins' | 'buckets';
  averageFullness: number;
}

interface MaturingBin {
  id: string;
  serialNumber: string;
  createdDate: string;
  readyDate: string;
  contents: MaturingBinContent[];
  collectorId: string;
  farmId: string;
  notes: string;
  status: 'maturing' | 'ready' | 'processed';
}

interface WriteRequest {
  bin: MaturingBin;
  collectorName: string;
  farmName: string;
}

// Initialize Google Sheets API with service account credentials
function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// Format date for display (DD-Mon-YYYY, e.g., 29-Dec-2025)
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleDateString('en-NZ', { month: 'short' });
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export default async (request: Request, context: Context) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const spreadsheetId = process.env.MATURING_BINS_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Maturing bins spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: WriteRequest = await request.json();
    const { bin, collectorName } = body;

    if (!bin || !bin.serialNumber) {
      return new Response(JSON.stringify({ error: 'Missing required fields: bin, serialNumber' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    // Extract unique business names for locations (up to 5)
    const uniqueBusinessNames = [...new Set(bin.contents.map(c => c.businessName))];
    const sources = [0, 1, 2, 3, 4].map(i => uniqueBusinessNames[i] || '');

    // Prepare row data to match current Bin Tracker columns (updated 2026-04-21):
    // A: Date of collection
    // B–F: Content from (sources 1–5)
    // G: Number (bin serial)
    // H onwards: Left blank — colour / maturation / batching filled in later
    const rowData = [
      formatDate(bin.createdDate),
      sources[0],
      sources[1],
      sources[2],
      sources[3],
      sources[4],
      bin.serialNumber,
    ];

    // Append the row to the Bin Tracker sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Bin Tracker!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Added maturing bin ${bin.serialNumber}`,
      serialNumber: bin.serialNumber,
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error writing to maturing bins sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write to maturing bins sheet',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
