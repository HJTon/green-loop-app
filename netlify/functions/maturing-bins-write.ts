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

// Format date for display (DD/MM/YYYY)
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-NZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Convert fullness percentage to readable format
function formatFullness(percent: number): string {
  if (percent >= 100) return 'Full';
  if (percent >= 75) return '3/4';
  if (percent >= 50) return 'Half';
  if (percent >= 25) return '1/4';
  return 'Empty';
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

    // Format contents description: "Cafe Verde (1 bin Full), Burger King (2 buckets 3/4)"
    const contentsDescription = bin.contents
      .map(c => {
        const typeLabel = c.collectionType === 'bins' ? 'bin' : 'bucket';
        const fullnessLabel = formatFullness(c.averageFullness);
        return `${c.businessName} (${c.binsCount} ${typeLabel} ${fullnessLabel})`;
      })
      .join(', ');

    // Format notes with collector name
    const notesWithCollector = bin.notes
      ? `${bin.notes} - Collected by ${collectorName}`
      : `Collected by ${collectorName}`;

    // Prepare row data to match existing Bin Tracker columns:
    // A: Date of collection
    // B: Content from (business names with details)
    // C: Number (serial number)
    // D: Colour (blank - assigned later at farm)
    // E: Date of Maturation
    // F: Date of Batching (blank - assigned later)
    // G: Batch (blank - assigned later)
    // H: Notes
    const rowData = [
      formatDate(bin.createdDate),      // A: Date of collection
      contentsDescription,               // B: Content from
      bin.serialNumber,                  // C: Number
      '',                                // D: Colour (blank)
      formatDate(bin.readyDate),         // E: Date of Maturation
      '',                                // F: Date of Batching (blank)
      '',                                // G: Batch (blank)
      notesWithCollector,                // H: Notes
    ];

    // Append the row to the Bin Tracker sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Bin Tracker!A:H',
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
