// Lazy runtime geocoder.
//
// For clients whose addresses haven't been pre-geocoded into coordinates.json,
// we fall back to a chain of live geocoders:
//   1. Nominatim (OpenStreetMap)  — primary, good NZ coverage, 1 req/sec cap
//   2. Photon (komoot)            — secondary, often resolves addresses
//                                   Nominatim chokes on (apartment numbers,
//                                   informal NZ addressing, sub-tenants)
// Results are cached in localStorage (and an in-memory map) keyed by the
// normalised address string, so subsequent loads pay no network cost.
//
// Before either geocoder is called, the address is run through
// `normaliseAddress` which strips Unit/Suite/Level prefixes and other
// patterns that confuse generic geocoders (see that fn for details). The
// original and normalised forms are logged so a driver hitting an unlocated
// stop can debug what we actually sent.
//
// When new clients become permanent fixtures, the bulk `scripts/geocode-
// locations.mjs` script can be re-run to promote their coords into the static
// file — but until then this keeps the optimiser honest: any stop with a real
// address ends up on the map.

export type Coord = { lat: number; lng: number };

const LS_KEY = 'greenloop:geocode-cache:v1';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PHOTON_URL = 'https://photon.komoot.io/api/';
const MIN_GAP_MS = 1100; // Nominatim free tier: max 1 request/sec.

interface CacheEntry {
  lat: number | null;
  lng: number | null;
  matchedAs?: string;
  failedAt?: number; // timestamp of last failed attempt (so we don't hammer)
  source?: 'nominatim' | 'photon' | 'baked'; // diagnostic — what produced the coord
}

/**
 * Normalise an NZ-style address so generic geocoders are more likely to match.
 *
 * Examples (case-insensitive, repeated as needed):
 *   "Unit 3 / 45 X St"     -> "45 X St"
 *   "Unit 3, 45 X St"      -> "45 X St"
 *   "Suite 5, 25 X St"     -> "25 X St"
 *   "Suite 5/25 X St"      -> "25 X St"
 *   "Level 2, 100 X St"    -> "100 X St"
 *   "Apt 4b, 12 X St"      -> "12 X St"
 *   "Flat 1, 7 X St"       -> "7 X St"
 *   "5/45 X St"            -> "45 X St"   (NZ-style flat number)
 *   "3a/45 X St"           -> "45 X St"
 *
 * The strategy is deliberately conservative — we only strip patterns that we
 * KNOW confuse geocoders. Anything ambiguous is left alone, and the caller
 * always tries the original form first (so a tidy address that happens to
 * trigger one of these patterns is still resolvable).
 */
export function normaliseAddress(address: string): string {
  if (!address) return address;
  let out = address.trim();

  // Drop a leading "Unit/Suite/Apt/Apartment/Level/Flat N[a-z], " or
  // "...N[a-z] / " segment.
  out = out.replace(
    /^(unit|suite|apt|apartment|level|flat)\s+\d+[a-z]?\s*[,/]\s*/i,
    ''
  );

  // Drop a leading bare "N[a-z]/" (e.g. "5/45 Sunley St", "3a/45 Sunley St").
  // Only when followed by another number — i.e. a real street-number pair —
  // otherwise "5 Vickers Rd" is fine.
  out = out.replace(/^\d+[a-z]?\s*\/\s*(?=\d)/i, '');

  return out.trim();
}

function loadCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to persist geocode cache:', err);
  }
}

let memCache: Record<string, CacheEntry> = loadCache();

export function getCachedCoord(address: string): Coord | null {
  if (!address) return null;
  const key = address.trim().toLowerCase();
  const hit = memCache[key];
  if (hit && hit.lat != null && hit.lng != null) {
    return { lat: hit.lat, lng: hit.lng };
  }
  return null;
}

// Serialised geocode queue — at most one Nominatim request per MIN_GAP_MS.
let lastRequestAt = 0;
const inflight = new Map<string, Promise<Coord | null>>();

interface GeocodeHit {
  coord: Coord;
  matchedAs?: string;
  source: 'nominatim' | 'photon';
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function nominatimGeocode(address: string): Promise<GeocodeHit | null> {
  // Honour Nominatim's 1 req/sec usage policy.
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=nz&email=greenloop-app@local`;
  // 10-second cap. Nominatim is usually <1s but we don't want a wedged
  // connection to leave the optimiser banner spinning forever.
  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  return {
    coord: { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) },
    matchedAs: results[0].display_name,
    source: 'nominatim',
  };
}

/**
 * Photon (komoot) fallback geocoder. No documented rate limit on the public
 * endpoint but they ask for "reasonable" use — we only hit it after Nominatim
 * has returned null for an address, so volumes are inherently low.
 *
 * Photon doesn't accept a countrycodes filter, so we bias toward NZ by:
 *   - using a bbox covering NZ (lon 165..180, lat -48..-33), and
 *   - filtering the result by `properties.country == "New Zealand"` to be safe.
 */
async function photonGeocode(address: string): Promise<GeocodeHit | null> {
  // Bbox bias toward NZ — Photon accepts &bbox=minLon,minLat,maxLon,maxLat
  const url =
    `${PHOTON_URL}?q=${encodeURIComponent(address)}&limit=1` +
    `&bbox=165,-48,180,-33`;
  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) throw new Error(`Photon returned ${res.status}`);
  const json = await res.json();
  const feat = json?.features?.[0];
  if (!feat || !Array.isArray(feat.geometry?.coordinates)) return null;
  const country = feat.properties?.country || '';
  if (country && country !== 'New Zealand' && country !== 'New Zealand / Aotearoa') {
    return null; // bbox didn't hold; ignore non-NZ hit
  }
  const [lng, lat] = feat.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const labelParts = [feat.properties?.name, feat.properties?.street, feat.properties?.city, country]
    .filter(Boolean);
  return {
    coord: { lat, lng },
    matchedAs: `${labelParts.join(', ')} (via Photon geocoder)`,
    source: 'photon',
  };
}

/**
 * Run the full geocoder chain for an address. Tries the original form first
 * (so a tidy address that happens to trigger the normaliser is still resolved
 * if it works as-is), then the normalised form. Within each form, tries
 * Nominatim, then Photon. Logs every attempt so unlocated stops are easy to
 * debug from the browser console.
 */
async function runGeocoderChain(address: string): Promise<GeocodeHit | null> {
  const original = address.trim();
  const normalised = normaliseAddress(original);
  const forms = normalised && normalised !== original ? [original, normalised] : [original];

  for (const form of forms) {
    if (form !== original) {
      console.info(`[geocode] retry "${original}" as normalised "${form}"`);
    }
    try {
      const hit = await nominatimGeocode(form);
      if (hit) {
        console.info(`[geocode] nominatim hit for "${form}"`);
        return hit;
      }
      console.info(`[geocode] nominatim miss for "${form}", trying Photon`);
    } catch (err) {
      console.warn(`[geocode] nominatim error for "${form}":`, err);
    }
    try {
      const hit = await photonGeocode(form);
      if (hit) {
        console.info(`[geocode] photon hit for "${form}"`);
        return hit;
      }
      console.info(`[geocode] photon miss for "${form}"`);
    } catch (err) {
      console.warn(`[geocode] photon error for "${form}":`, err);
    }
  }
  return null;
}

export async function geocodeAddress(address: string): Promise<Coord | null> {
  if (!address) return null;
  const key = address.trim().toLowerCase();

  const hit = memCache[key];
  if (hit) {
    if (hit.lat != null && hit.lng != null) return { lat: hit.lat, lng: hit.lng };
    // If we tried recently and failed, don't retry immediately.
    if (hit.failedAt && Date.now() - hit.failedAt < 24 * 60 * 60 * 1000) return null;
  }

  // Coalesce concurrent requests for the same address.
  if (inflight.has(key)) return inflight.get(key)!;

  const promise = (async () => {
    try {
      const result = await runGeocoderChain(address);
      if (result) {
        memCache[key] = {
          lat: result.coord.lat,
          lng: result.coord.lng,
          matchedAs: result.matchedAs,
          source: result.source,
        };
      } else {
        console.warn(`[geocode] all geocoders missed for "${address}"`);
        memCache[key] = { lat: null, lng: null, failedAt: Date.now() };
      }
      saveCache(memCache);
      return result?.coord ?? null;
    } catch (err) {
      console.warn(`Geocode failed for "${address}":`, err);
      memCache[key] = { lat: null, lng: null, failedAt: Date.now() };
      saveCache(memCache);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Forget a single address's cached geocode result — both the success and the
 * 24-hour failure record. Used by the per-stop "retry" button so a driver can
 * force a fresh lookup without nuking the whole cache.
 */
export function forgetGeocode(address: string): void {
  if (!address) return;
  const key = address.trim().toLowerCase();
  delete memCache[key];
  saveCache(memCache);
}

/**
 * Forget then re-geocode a single address. Returns the new coord (or null
 * if everything in the chain still misses). The retry-button handler is the
 * sole expected caller.
 */
export async function retryGeocode(address: string): Promise<Coord | null> {
  forgetGeocode(address);
  return geocodeAddress(address);
}

// Geocode many addresses; returns the count actually fetched (not cached).
export async function ensureGeocoded(addresses: string[]): Promise<number> {
  const unique = Array.from(new Set(addresses.map(a => a.trim()).filter(Boolean)));
  let fetched = 0;
  for (const addr of unique) {
    if (getCachedCoord(addr)) continue;
    const before = memCache[addr.toLowerCase()];
    await geocodeAddress(addr);
    const after = memCache[addr.toLowerCase()];
    if (!before && after) fetched++;
  }
  return fetched;
}

export function clearGeocodeCache(): void {
  memCache = {};
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

// --- Background sweep ----------------------------------------------------
//
// Once a day (and on app boot) we look back over every address we've failed
// to geocode and quietly retry it. The goal is self-healing: if Nominatim is
// briefly flaky at 8 am on Monday, a stop that gets a "No location" badge
// shouldn't stay broken for the rest of the working day — it should resolve
// the next time the sweep runs.
//
// Rules:
//   - Only retry entries with null coords AND a failedAt older than 24h.
//     Otherwise a session of failures would loop on itself within minutes.
//   - At most one request per second, to honour Nominatim's stated limit.
//     Photon's public endpoint is similar.
//   - Reuse `geocodeAddress` so the 24-hour failure marker, in-flight
//     coalescing, and persistence behaviour are identical to a normal call.
//   - Logs progress to console so a driver who calls Joe over can paste it.

const STALE_FAILURE_MS = 24 * 60 * 60 * 1000;

let sweepInFlight: Promise<{ retried: number; recovered: number }> | null = null;

/**
 * Scan the cache for stale failures and retry them. Returns a summary so
 * callers can log it (or surface a toast). Safe to call concurrently —
 * back-to-back calls collapse onto the same promise.
 */
export async function runGeocodeSweep(): Promise<{ retried: number; recovered: number }> {
  if (sweepInFlight) return sweepInFlight;

  sweepInFlight = (async () => {
    const now = Date.now();
    // Snapshot the keys we want to retry up front so a long sweep doesn't keep
    // re-evaluating entries we've just touched.
    const candidates: string[] = [];
    for (const [key, entry] of Object.entries(memCache)) {
      if (entry.lat != null && entry.lng != null) continue;
      if (!entry.failedAt) continue;
      if (now - entry.failedAt < STALE_FAILURE_MS) continue;
      candidates.push(key);
    }

    if (candidates.length === 0) {
      console.info('[geocode-sweep] nothing stale to retry');
      return { retried: 0, recovered: 0 };
    }

    console.info(`[geocode-sweep] retrying ${candidates.length} stale failure(s)`);
    let recovered = 0;

    for (const key of candidates) {
      // Drop the 24h failure marker so geocodeAddress will actually run the
      // chain again rather than return null from the cache.
      delete memCache[key];
      // geocodeAddress already enforces a ~1.1s gap between Nominatim calls
      // (see lastRequestAt / MIN_GAP_MS), so we don't need a manual sleep.
      const coord = await geocodeAddress(key);
      if (coord) {
        recovered++;
        console.info(`[geocode-sweep] recovered "${key}"`);
      }
    }
    saveCache(memCache);
    console.info(`[geocode-sweep] done — recovered ${recovered}/${candidates.length}`);
    return { retried: candidates.length, recovered };
  })();

  try {
    return await sweepInFlight;
  } finally {
    sweepInFlight = null;
  }
}
