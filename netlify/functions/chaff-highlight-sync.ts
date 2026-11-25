import type { Context } from '@netlify/functions';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';
import { getSheetsClient } from './_lib/impact-settings';
import { syncChaffHighlights } from './_lib/chaff-highlight';

// Re-applies the chaffed-pickle blue highlights on the Bin Tracker (see _lib/chaff-highlight.ts).
// It also runs automatically after maturing-bins-write, after a chaff/Zing pickup note, and daily.
// `?dryRun=1` reports what would change and writes nothing.
export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  try {
    const result = await syncChaffHighlights(getSheetsClient(), dryRun);
    return new Response(JSON.stringify({ success: true, dryRun, ...result }, null, 1), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('chaff-highlight-sync failed:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
