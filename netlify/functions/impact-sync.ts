import type { Context } from '@netlify/functions';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';
import { runImpactSync } from './_lib/impact-settings';

// POST (bearer auth). Ensures the "Impact Reports" tab exists and every
// invoicing business has a row with a link code. ?dryRun=1 returns the plan
// without writing anything.
export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const plan = await runImpactSync(dryRun);
    return new Response(JSON.stringify({ success: true, dryRun, ...plan }), { status: 200, headers });
  } catch (error) {
    console.error('impact-sync failed:', error);
    return new Response(JSON.stringify({
      error: 'Impact sync failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers });
  }
};
