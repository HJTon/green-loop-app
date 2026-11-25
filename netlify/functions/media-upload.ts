import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

interface UploadRequest {
  mediaData: string;   // base64, may include data URL prefix
  mimeType: string;
  filename: string;    // e.g. "2026-04-17_Cafe-Verde_pickup_abc123.jpg"
}

const STORE_NAME = 'greenloop-media';
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — headroom under Netlify's 6 MB body limit

export default async (request: Request, _context: Context) => {
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
    const body: UploadRequest = await request.json();
    const { mediaData, mimeType, filename } = body;

    if (!mediaData || !filename) {
      return new Response(JSON.stringify({ error: 'Missing required fields: mediaData, filename' }), {
        status: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Strip data URL prefix if present
    const base64 = mediaData.includes(',') ? mediaData.split(',')[1] : mediaData;
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'File too large — maximum 4 MB per upload' }), {
        status: 413,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    // Use the filename as the key so it's human-readable in the Blobs dashboard
    await store.set(filename, buffer, {
      metadata: { mimeType: mimeType || 'image/jpeg', uploadedAt: new Date().toISOString() },
    });

    // Public URL via our serve function
    const url = `/.netlify/functions/media-serve?key=${encodeURIComponent(filename)}`;

    return new Response(JSON.stringify({ success: true, url, key: filename }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    return new Response(JSON.stringify({
      error: 'Failed to upload media',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
