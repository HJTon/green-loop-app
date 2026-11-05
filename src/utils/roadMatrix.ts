// Road travel-time / distance matrix via OpenRouteService.
//
// Given a set of lat/lng points we ask ORS for an N×N matrix of pairwise
// driving durations and distances. Results are cached in localStorage keyed
// by a hash of the (rounded) coordinate list, so reopening the modal on the
// same route is free. When the API is unreachable (no key, offline, rate
// limited) callers can fall back to haversine — this keeps the optimiser
// useful in the field even if ORS is down.

export type Coord = { lat: number; lng: number };

export interface RoadMatrix {
  // durations[i][j] = driving seconds from point i to point j
  durations: number[][];
  // distances[i][j] = metres
  distances: number[][];
}

const LS_KEY = 'greenloop:road-matrix-cache:v1';
const ENDPOINT = 'https://api.openrouteservice.org/v2/matrix/driving-car';

// Round coords to ~10m precision so trivially different inputs share a cache key.
function roundCoord(c: Coord): string {
  return `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
}

function cacheKey(points: Coord[]): string {
  return points.map(roundCoord).join('|');
}

interface CachedMatrix extends RoadMatrix {
  cachedAt: number;
}

function loadCache(): Record<string, CachedMatrix> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CachedMatrix>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CachedMatrix>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to persist road matrix cache:', err);
  }
}

// Treat cached matrices as fresh for a week. Road networks don't change daily
// and we'd rather a small staleness than a daily API call per driver.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let memCache: Record<string, CachedMatrix> | null = null;

export function getCachedMatrix(points: Coord[]): RoadMatrix | null {
  if (memCache == null) memCache = loadCache();
  const key = cacheKey(points);
  const hit = memCache[key];
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > MAX_AGE_MS) return null;
  return { durations: hit.durations, distances: hit.distances };
}

function storeMatrix(points: Coord[], matrix: RoadMatrix): void {
  if (memCache == null) memCache = loadCache();
  const key = cacheKey(points);
  memCache[key] = { ...matrix, cachedAt: Date.now() };
  saveCache(memCache);
}

export class RoadMatrixError extends Error {
  readonly kind: 'no-key' | 'http' | 'shape';
  constructor(message: string, kind: 'no-key' | 'http' | 'shape') {
    super(message);
    this.name = 'RoadMatrixError';
    this.kind = kind;
  }
}

export async function fetchRoadMatrix(points: Coord[]): Promise<RoadMatrix> {
  if (points.length < 2) {
    return { durations: [[0]], distances: [[0]] };
  }

  const cached = getCachedMatrix(points);
  if (cached) return cached;

  const apiKey = import.meta.env.VITE_ORS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new RoadMatrixError('No VITE_ORS_API_KEY configured', 'no-key');
  }

  // ORS expects [lng, lat] pairs, not [lat, lng].
  const locations = points.map(p => [p.lng, p.lat]);

  // 15-second cap — on a flaky connection we'd rather fall back to haversine
  // than leave the driver staring at a spinner.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        locations,
        metrics: ['duration', 'distance'],
        units: 'm',
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new RoadMatrixError(
      `ORS matrix request failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
      'http'
    );
  }

  const json = await res.json();
  if (!Array.isArray(json.durations) || !Array.isArray(json.distances)) {
    throw new RoadMatrixError('ORS response missing durations/distances', 'shape');
  }

  const matrix: RoadMatrix = {
    durations: json.durations,
    distances: json.distances,
  };
  storeMatrix(points, matrix);
  return matrix;
}

export function clearRoadMatrixCache(): void {
  memCache = {};
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}
