import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

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
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

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

    // Extract unique business names for locations (up to 3)
    const uniqueBusinessNames = [...new Set(bin.contents.map(c => c.businessName))];
    const location1 = uniqueBusinessNames[0] || '';
    const location2 = uniqueBusinessNames[1] || '';
    const location3 = uniqueBusinessNames[2] || '';

    // Prepare row data to match existing Bin Tracker columns:
    // A: Date of collection
    // B: Location 1 (business name)
    // C: Location 2 (business name)
    // D: Location 3 (business name)
    // E: Bin number (serial number)
    // F onwards: Left blank - sheet calculates maturing date, colour/batch assigned later
    const rowData = [
      formatDate(bin.createdDate),      // A: Date of collection
      location1,                         // B: Location 1
      location2,                         // C: Location 2
      location3,                         // D: Location 3
      bin.serialNumber,                  // E: Bin number
    ];

    // Append the row to the Bin Tracker sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Bin Tracker!A:E',
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error writing to maturing bins sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write to maturing bins sheet',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
