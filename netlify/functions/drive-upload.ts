import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { Readable } from 'stream';

// Initialize Google Drive API with service account credentials
function getGoogleDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

interface UploadRequest {
  imageData: string;      // Base64 encoded image
  mimeType: string;       // e.g., 'image/jpeg'
  date: string;           // e.g., '2026-02-13'
  businessName: string;   // e.g., 'Cafe Verde'
  photoType: string;      // e.g., 'pickup' or 'issue'
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
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!rootFolderId) {
      return new Response(JSON.stringify({ error: 'Drive folder ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: UploadRequest = await request.json();
    const { imageData, mimeType, date, businessName, photoType } = body;

    if (!imageData || !date || !businessName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const drive = getGoogleDriveClient();

    // Generate filename with date and business name for organization
    // Format: 2026-02-13_Cafe-Verde_pickup_143052.jpg
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
    const safeBizName = businessName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
    const filename = `${date}_${safeBizName}_${photoType || 'photo'}_${timestamp}.jpg`;

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Upload directly to the shared folder (no subfolders - service accounts can't create them)
    const fileMetadata = {
      name: filename,
      parents: [rootFolderId],
    };

    const media = {
      mimeType: mimeType || 'image/jpeg',
      body: Readable.from(imageBuffer),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, webViewLink, webContentLink',
    });

    // Make file viewable by anyone with the link
    await drive.permissions.create({
      fileId: file.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    // Get the direct thumbnail link
    const thumbnailLink = `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w400`;

    return new Response(JSON.stringify({
      success: true,
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
      thumbnailLink,
      filename,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error uploading to Drive:', error);
    return new Response(JSON.stringify({
      error: 'Failed to upload to Drive',
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
