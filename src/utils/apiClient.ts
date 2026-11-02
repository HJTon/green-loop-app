// Thin wrapper around fetch() that adds our shared API secret as a Bearer
// token. Use this for every call to `/.netlify/functions/*` (except media-serve,
// which is read by <img src> tags that can't send custom headers).
//
// The secret is embedded in the bundled JS at build time via the
// VITE_API_SECRET env var. This is security-by-obscurity for an internal app —
// it stops random callers, but anyone who downloads the bundle can extract
// the secret from devtools. Treat it as a low bar, not a real boundary.

const API_SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (API_SECRET) {
    headers.set('Authorization', `Bearer ${API_SECRET}`);
  }
  return fetch(input, { ...init, headers });
}
