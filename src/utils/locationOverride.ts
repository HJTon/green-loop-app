// Manual lat/lng override parsing for clients whose addresses won't geocode
// cleanly through Nominatim / Photon. Two accepted input shapes:
//
//   1. A Google Maps share / link URL — handles the two common formats:
//      - "https://maps.google.com/?q=-39.0578,174.0876"            (mobile share)
//      - "https://www.google.com/maps/place/.../@-39.0578,174.0876,17z" (browser)
//      - "https://www.google.com/maps?ll=-39.0578,174.0876"        (older "ll=")
//      - "https://goo.gl/maps/..."                                  (short link — not parsed)
//   2. Plain coordinates as text — "-39.0578, 174.0876" or "-39.0578,174.0876".
//
// Both go through a NZ sanity check (-48 ≤ lat ≤ -33, 165 ≤ lng ≤ 180) so a
// typo like "39.0578, 174" (positive latitude, i.e. somewhere in the northern
// hemisphere) is rejected rather than silently placing the stop in the Pacific.
//
// Short links (goo.gl/maps/..., maps.app.goo.gl/...) can't be expanded
// client-side; the parser surfaces a friendly error so the driver knows to
// open the short link and copy the long URL out of the browser's address bar.
export interface ParsedOverride {
  lat: number;
  lng: number;
}

export interface ParseResult {
  ok: true;
  value: ParsedOverride;
}
export interface ParseError {
  ok: false;
  error: string;
}

// NZ bounding box. Anything outside this is almost certainly a paste error.
const NZ_BBOX = {
  minLat: -48,
  maxLat: -33,
  minLng: 165,
  maxLng: 180,
};

function isNZish(lat: number, lng: number): boolean {
  return (
    lat >= NZ_BBOX.minLat &&
    lat <= NZ_BBOX.maxLat &&
    lng >= NZ_BBOX.minLng &&
    lng <= NZ_BBOX.maxLng
  );
}

/**
 * Parse a Google Maps URL or a plain "lat, lng" string into coordinates. On
 * success returns the coord; on failure returns a human-readable error so the
 * caller can surface it next to the input field.
 */
export function parseLocationInput(raw: string): ParseResult | ParseError {
  const text = (raw || '').trim();
  if (!text) {
    return { ok: false, error: 'Paste a Google Maps link or type lat, lng' };
  }

  // Plain "lat, lng" (or "lat,lng" / "lat lng") — try this BEFORE URL parsing
  // so a paste like "-39.0578, 174.0876" isn't mistaken for a URL fragment.
  const plain = parsePlainCoords(text);
  if (plain) {
    return validate(plain.lat, plain.lng);
  }

  // Short-link bail: we can't expand these without a network call.
  if (/^https?:\/\/(goo\.gl|maps\.app\.goo\.gl)\b/i.test(text)) {
    return {
      ok: false,
      error: 'Short Maps links can\'t be read. Open it, then copy the full URL from the address bar.',
    };
  }

  if (/^https?:\/\//i.test(text)) {
    const fromUrl = parseMapsUrl(text);
    if (fromUrl) {
      return validate(fromUrl.lat, fromUrl.lng);
    }
    return {
      ok: false,
      error: 'Couldn\'t find a coordinate in that link. Try right-click → "What\'s here?" on Maps and paste the result.',
    };
  }

  return {
    ok: false,
    error: 'Paste a Google Maps link, or type the coords as "lat, lng".',
  };
}

function validate(lat: number, lng: number): ParseResult | ParseError {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: 'That doesn\'t look like a valid coordinate.' };
  }
  if (!isNZish(lat, lng)) {
    return {
      ok: false,
      error: `Coords ${lat.toFixed(4)}, ${lng.toFixed(4)} are outside New Zealand — double-check the order (lat, lng).`,
    };
  }
  return { ok: true, value: { lat, lng } };
}

function parsePlainCoords(text: string): ParsedOverride | null {
  // Match "lat,lng" or "lat, lng" or "lat lng" with optional trailing junk.
  // Latitudes can be negative; longitudes can be negative too in general but
  // for NZ they're always positive — we let validate() catch sign mistakes.
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

function parseMapsUrl(text: string): ParsedOverride | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  // Form 1: ?q=lat,lng  (mobile share)
  // Form 1b: ?q=loc:lat,lng (some shares)
  const q = url.searchParams.get('q');
  if (q) {
    const fromQ = parsePlainCoords(q.replace(/^loc:/i, '')) ?? extractAtFragment(q);
    if (fromQ) return fromQ;
  }

  // Form 2: ?ll=lat,lng  (older link format)
  const ll = url.searchParams.get('ll');
  if (ll) {
    const fromLl = parsePlainCoords(ll);
    if (fromLl) return fromLl;
  }

  // Form 3: pathname contains "/@lat,lng,zoom"  (browser place URL)
  const fromAt = extractAtFragment(url.pathname + url.hash);
  if (fromAt) return fromAt;

  // Form 4: ?destination=lat,lng / ?center=lat,lng  (directions / embed)
  for (const param of ['destination', 'center', 'origin']) {
    const v = url.searchParams.get(param);
    if (v) {
      const p = parsePlainCoords(v);
      if (p) return p;
    }
  }

  return null;
}

// Finds the first "@lat,lng" segment in a string (browser URLs put it in
// the path, e.g. ".../maps/place/Foo/@-39.0578,174.0876,17z/..."). Returns
// null if no such segment is present.
function extractAtFragment(text: string): ParsedOverride | null {
  const m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

/**
 * Format a coord for display in the override input ("lat, lng" rounded to 5dp).
 * Used to pre-populate the editor when the user opens an existing override.
 */
export function formatOverride(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
