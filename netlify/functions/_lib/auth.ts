// Shared API authentication for Netlify functions.
//
// Threat model: prevent random callers on the internet from hitting our
// data-mutating endpoints. The secret is a shared bearer token configured
// as an env var on the server and embedded in the bundled JS on the client
// (VITE_API_SECRET). Anyone who downloads the bundle can extract the secret
// from devtools, so this is security-by-obscurity for an internal app —
// not a replacement for proper user auth. It DOES stop the casual attacker
// who just hits a URL.

const ALLOW_HEADERS = 'Content-Type, Authorization';

export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    ...extra,
  };
}

// Standard CORS preflight response. Functions can call this from their
// `if (request.method === 'OPTIONS')` branch.
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Check the request's Authorization header against API_SECRET.
// Returns null if authorised; returns a 401 Response if not.
//
// If API_SECRET isn't configured on the server we *fail closed* — better to
// have all functions stop working than silently fall back to no-auth.
export function checkAuth(request: Request): Response | null {
  const expected = process.env.API_SECRET;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: API_SECRET not set' }),
      { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  }

  const got = request.headers.get('Authorization');
  if (got !== `Bearer ${expected}`) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  }

  return null;
}
