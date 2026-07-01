import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

// One-off migration for the `invoicing` sheet tab:
//   1. Insert two blank columns at position C (new C + D) for Contact Person / Phone Number.
//   2. Write headers in row 2 for the new columns.
//   3. Copy the unified formula row K78:MM78 down to rows 79..300 so the every-3rd-row
//      Pick Up / bin-count formula coverage extends beyond row 78.
//
// Idempotent-ish guard: refuses to run if the headers at C2/D2 already say
// CONTACT PERSON / PHONE NUMBER (i.e. migration already done).

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

  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return json({ error: 'Spreadsheet ID not configured' }, 500);
    }

    const sheets = getGoogleSheetsClient();

    // Find the sheetId of the `invoicing` tab
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const allTabs = meta.data.sheets?.map(s => s.properties?.title) || [];
    const tab = meta.data.sheets?.find(
      s => (s.properties?.title || '').trim().toLowerCase() === 'invoicing',
    );
    if (!tab || tab.properties?.sheetId == null) {
      return json({ error: 'invoicing tab not found', availableTabs: allTabs }, 404);
    }
    const sheetId = tab.properties.sheetId;

    // Idempotency check
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'invoicing!C2:D2',
    });
    const headerRow = existing.data.values?.[0] || [];
    if (headerRow[0] === 'CONTACT PERSON' && headerRow[1] === 'PHONE NUMBER') {
      return json({ skipped: true, reason: 'migration already applied' });
    }

    // Before the insert, K78:MM78 is the template. K is col index 10 (0-based),
    // MM is col index 350. After inserting 2 columns at index 2, those shift to
    // 12 and 352 respectively. Since we do both in the same batchUpdate, we
    // specify the copyPaste *after* the insert using the post-insert indices.

    const requests: any[] = [
      // 1. Insert two blank columns at index 2 (inserts BEFORE the current col C)
      {
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 2,
            endIndex: 4,
          },
          inheritFromBefore: false,
        },
      },
      // 2. Set headers in row 2 for new C + D (post-insert, still C2 and D2)
      {
        updateCells: {
          start: { sheetId, rowIndex: 1, columnIndex: 2 },
          rows: [
            {
              values: [
                { userEnteredValue: { stringValue: 'CONTACT PERSON' } },
                { userEnteredValue: { stringValue: 'PHONE NUMBER' } },
              ],
            },
          ],
          fields: 'userEnteredValue',
        },
      },
      // 3. Copy the row-78 template (now at shifted cols 12..352) down to rows 79..300.
      //    copyPaste auto-expands a 1-row source across the destination rows and
      //    adjusts relative references per row.
      {
        copyPaste: {
          source: {
            sheetId,
            startRowIndex: 77, // row 78 (0-indexed)
            endRowIndex: 78,
            startColumnIndex: 12, // was col K (10), +2 after insert
            endColumnIndex: 353,  // was col MM (350) exclusive-end 351, +2 => 353
          },
          destination: {
            sheetId,
            startRowIndex: 78,  // row 79
            endRowIndex: 300,   // row 300 inclusive (exclusive-end)
            startColumnIndex: 12,
            endColumnIndex: 353,
          },
          pasteType: 'PASTE_NORMAL',
          pasteOrientation: 'NORMAL',
        },
      },
    ];

    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });

    return json({
      success: true,
      replies: result.data.replies?.length,
      message:
        'Inserted 2 columns at C/D, wrote headers CONTACT PERSON / PHONE NUMBER, copied row-78 formulas down to row 300.',
    });
  } catch (error) {
    console.error('Migration error:', error);
    return json(
      {
        error: 'Migration failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
