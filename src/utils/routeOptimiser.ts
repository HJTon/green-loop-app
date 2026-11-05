// Route optimisation for the daily collection round.
//
// Solves the "open" Travelling Salesman Problem with fixed start and end
// points (a Hamiltonian path from start, through every stop, to finish)
// exactly via the Held-Karp dynamic-programming algorithm. Held-Karp is
// O(n^2 * 2^n), which is fine on a phone for the n <= ~15 stops a collector
// would ever do in a day. If we ever push past that we'll fall back to
// nearest-neighbour + 2-opt; for now the daily round fits comfortably.

import coordinatesData from '@/data/coordinates.json';
import startLocationsData from '@/data/start-locations.json';
import farmsRaw from '@/data/farms.json';
import { getCachedCoord } from './geocodeCache';
import type { Client, Farm } from '@/types';

type Coord = { lat: number; lng: number };
type CoordEntry = { lat: number | null; lng: number | null; address: string };

const coordinates = coordinatesData as Record<string, CoordEntry>;

export interface StartLocation {
  id: string;
  name: string;
  address: string;
  active: boolean;
}

export const startLocations: StartLocation[] = startLocationsData as StartLocation[];

export function getStartCoordinates(startId: string): Coord | null {
  const entry = coordinates[`start:${startId}`];
  if (!entry || entry.lat == null || entry.lng == null) return null;
  return { lat: entry.lat, lng: entry.lng };
}

export function getFarmCoordinates(farmId: string): Coord | null {
  const entry = coordinates[`farm:${farmId}`];
  if (!entry || entry.lat == null || entry.lng == null) return null;
  return { lat: entry.lat, lng: entry.lng };
}

export function getClientCoordinates(client: Client): Coord | null {
  // Manual override (sheet columns N / O) — always wins. This is the escape
  // hatch for addresses that won't geocode cleanly (rural delivery, brand-new
  // builds, landmark-only sites). Driver paste/typing is validated against
  // the NZ bbox in locationOverride.ts before it ever lands here.
  if (client.manual_lat != null && client.manual_lng != null) {
    return { lat: client.manual_lat, lng: client.manual_lng };
  }
  // Pre-geocoded coordinates baked into the data file (fast, deterministic).
  const entry = coordinates[client.business_name];
  if (entry && entry.lat != null && entry.lng != null) {
    return { lat: entry.lat, lng: entry.lng };
  }
  // Fall back to the runtime cache populated by geocodeAddress.
  return getCachedCoord(client.address);
}

// Great-circle distance in km between two lat/lng points (haversine).
// Good enough as a proxy for driving distance when the area is small and
// roughly grid-shaped, as New Plymouth is.
export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface OptimiseInput {
  start: Coord;
  end: Coord;
  stops: { id: string; coord: Coord }[];
}

export interface OptimiseResult {
  orderedIds: string[];
  totalKm: number;
}

// Inner Held-Karp solver — operates purely on cost matrices so it can be fed
// either haversine kilometres or real road-network seconds depending on what
// the caller has available.
interface HeldKarpInput {
  ids: string[];
  startToStop: number[];
  stopToEnd: number[];
  between: number[][];
}

// Beyond ~16 stops Held-Karp's O(n·2^n) memory becomes a problem on a phone
// (n=20 alone would allocate ~160 MB just for dp). Daily collection rounds
// don't approach that, but if someone ever adds two dozen stops we'd rather
// fall back to a heuristic than crash the tab.
const HELD_KARP_MAX_N = 16;

function heldKarp({ ids, startToStop, stopToEnd, between }: HeldKarpInput): { orderedIds: string[]; total: number } {
  const n = ids.length;
  if (n === 0) return { orderedIds: [], total: 0 };
  if (n === 1) return { orderedIds: [ids[0]], total: startToStop[0] + stopToEnd[0] };

  if (n > HELD_KARP_MAX_N) {
    return nearestNeighbourThenTwoOpt({ ids, startToStop, stopToEnd, between });
  }

  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);

  for (let i = 0; i < n; i++) {
    dp[(1 << i) * n + i] = startToStop[i];
  }

  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const cur = dp[mask * n + last];
      if (cur === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const newMask = mask | (1 << next);
        const cand = cur + between[last][next];
        if (cand < dp[newMask * n + next]) {
          dp[newMask * n + next] = cand;
          parent[newMask * n + next] = last;
        }
      }
    }
  }

  const fullMask = size - 1;
  let bestLast = 0;
  let bestTotal = Infinity;
  for (let i = 0; i < n; i++) {
    const total = dp[fullMask * n + i] + stopToEnd[i];
    if (total < bestTotal) {
      bestTotal = total;
      bestLast = i;
    }
  }

  const orderRev: number[] = [];
  let mask = fullMask;
  let cur = bestLast;
  while (cur !== -1) {
    orderRev.push(cur);
    const prev = parent[mask * n + cur];
    mask ^= 1 << cur;
    cur = prev;
  }
  return {
    orderedIds: orderRev.reverse().map(i => ids[i]),
    total: bestTotal,
  };
}

// Nearest-neighbour + 2-opt heuristic. Used when n is too large for Held-Karp.
// Within ~5–15% of optimum in practice for road networks, and runs in O(n^3).
function nearestNeighbourThenTwoOpt({ ids, startToStop, stopToEnd, between }: HeldKarpInput): { orderedIds: string[]; total: number } {
  const n = ids.length;
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];

  // Nearest neighbour from the start.
  let last = -1;
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const cost = last === -1 ? startToStop[i] : between[last][i];
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    visited[bestIdx] = true;
    order.push(bestIdx);
    last = bestIdx;
  }

  // 2-opt improvement: try every pair of edges, reverse the segment between
  // them if it shortens the route. Keep sweeping until no improvement.
  const routeCost = (route: number[]): number => {
    let total = startToStop[route[0]];
    for (let i = 1; i < route.length; i++) total += between[route[i - 1]][route[i]];
    total += stopToEnd[route[route.length - 1]];
    return total;
  };

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const reversed = [...order];
        reversed.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
        if (routeCost(reversed) < routeCost(order) - 1e-9) {
          for (let k = 0; k < reversed.length; k++) order[k] = reversed[k];
          improved = true;
        }
      }
    }
  }

  return {
    orderedIds: order.map(i => ids[i]),
    total: routeCost(order),
  };
}

// Straight-line optimisation — used as a fallback when no road matrix is
// available (offline / no API key / API failure).
export function optimiseRoute(input: OptimiseInput): OptimiseResult {
  const { start, end, stops } = input;
  const n = stops.length;
  if (n === 0) return { orderedIds: [], totalKm: haversineKm(start, end) };

  const result = heldKarp({
    ids: stops.map(s => s.id),
    startToStop: stops.map(s => haversineKm(start, s.coord)),
    stopToEnd: stops.map(s => haversineKm(s.coord, end)),
    between: stops.map(a => stops.map(b => haversineKm(a.coord, b.coord))),
  });
  return { orderedIds: result.orderedIds, totalKm: result.total };
}

// Road-aware optimisation. `roadMatrix` must be ordered as
// [start, stops[0], stops[1], ..., stops[n-1], end]. Optimises on driving
// seconds (totalSeconds) and reports the corresponding metres (totalMeters)
// for the chosen order.
export interface RoadOptimiseResult {
  orderedIds: string[];
  totalSeconds: number;
  totalMeters: number;
}

export function optimiseRouteByRoad(
  input: OptimiseInput,
  matrix: { durations: number[][]; distances: number[][] }
): RoadOptimiseResult {
  const { stops } = input;
  const n = stops.length;
  const startIdx = 0;
  const endIdx = n + 1;

  if (n === 0) {
    return {
      orderedIds: [],
      totalSeconds: matrix.durations[startIdx][endIdx],
      totalMeters: matrix.distances[startIdx][endIdx],
    };
  }

  const startToStop = Array.from({ length: n }, (_, i) => matrix.durations[startIdx][i + 1]);
  const stopToEnd = Array.from({ length: n }, (_, i) => matrix.durations[i + 1][endIdx]);
  const between = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => matrix.durations[i + 1][j + 1])
  );

  const result = heldKarp({
    ids: stops.map(s => s.id),
    startToStop,
    stopToEnd,
    between,
  });

  // Walk the chosen order in the distance matrix to report road-km too.
  const order = result.orderedIds.map(id => stops.findIndex(s => s.id === id));
  let meters = matrix.distances[startIdx][order[0] + 1];
  for (let i = 1; i < order.length; i++) {
    meters += matrix.distances[order[i - 1] + 1][order[i] + 1];
  }
  meters += matrix.distances[order[order.length - 1] + 1][endIdx];

  return { orderedIds: result.orderedIds, totalSeconds: result.total, totalMeters: meters };
}

// Subset optimisation over a shared road matrix. Unlike optimiseRouteByRoad
// (which assumes the matrix is laid out as exactly [start, ...stops, end]), this
// takes explicit matrix row indices for the start, the end, and an arbitrary
// subset of stops. It's what powers the two-run split planner: one matrix is
// fetched over the union of every point, then each run is optimised by handing
// in just its own start/end/stop indices.
export interface SubsetOptimiseResult {
  // The supplied stop indices, reordered into the optimal visiting sequence.
  orderedStopIdxs: number[];
  totalSeconds: number;
  totalMeters: number;
}

export function optimiseSubsetByRoad(
  matrix: { durations: number[][]; distances: number[][] },
  startIdx: number,
  endIdx: number,
  stopIdxs: number[]
): SubsetOptimiseResult {
  const n = stopIdxs.length;
  if (n === 0) {
    return {
      orderedStopIdxs: [],
      totalSeconds: matrix.durations[startIdx][endIdx],
      totalMeters: matrix.distances[startIdx][endIdx],
    };
  }

  // heldKarp keys purely by the position of each entry, so we can label the
  // stops with their matrix indices and read them straight back out.
  const ids = stopIdxs.map(String);
  const startToStop = stopIdxs.map(s => matrix.durations[startIdx][s]);
  const stopToEnd = stopIdxs.map(s => matrix.durations[s][endIdx]);
  const between = stopIdxs.map(a => stopIdxs.map(b => matrix.durations[a][b]));

  const result = heldKarp({ ids, startToStop, stopToEnd, between });
  const orderedStopIdxs = result.orderedIds.map(Number);

  let meters = matrix.distances[startIdx][orderedStopIdxs[0]];
  for (let i = 1; i < orderedStopIdxs.length; i++) {
    meters += matrix.distances[orderedStopIdxs[i - 1]][orderedStopIdxs[i]];
  }
  meters += matrix.distances[orderedStopIdxs[orderedStopIdxs.length - 1]][endIdx];

  return { orderedStopIdxs, totalSeconds: result.total, totalMeters: meters };
}

// Total driving seconds + metres for an arbitrary given order (used to compute
// the "current order" baseline for the savings display).
export function roadCostForOrder(
  orderedStopIndices: number[],
  matrix: { durations: number[][]; distances: number[][] }
): { seconds: number; meters: number } {
  const startIdx = 0;
  const endIdx = orderedStopIndices.length + 1;
  // Map a "stop index in the original stops[] array" to its row in the matrix.
  // The matrix layout matches what we passed to fetchRoadMatrix:
  // [start, stops[0], stops[1], ..., end]. So matrix row = stopIndex + 1.
  let seconds = 0;
  let meters = 0;
  let prev = startIdx;
  for (const idx of orderedStopIndices) {
    const row = idx + 1;
    seconds += matrix.durations[prev][row];
    meters += matrix.distances[prev][row];
    prev = row;
  }
  seconds += matrix.durations[prev][endIdx];
  meters += matrix.distances[prev][endIdx];
  return { seconds, meters };
}

// Distance of a route visited in the given stop order.
export function routeDistanceKm(
  start: Coord,
  end: Coord,
  orderedStops: Coord[]
): number {
  let total = 0;
  let prev = start;
  for (const s of orderedStops) {
    total += haversineKm(prev, s);
    prev = s;
  }
  total += haversineKm(prev, end);
  return total;
}

// Google Maps directions deep-link. The "/dir/" form takes addresses
// separated by slashes; Maps reads them in order and gives turn-by-turn
// navigation for the whole route in one tap.
export function buildGoogleMapsUrl(addresses: string[]): string {
  const cleaned = addresses
    .map(a => a.trim())
    .filter(Boolean)
    .map(a => encodeURIComponent(a));
  return `https://www.google.com/maps/dir/${cleaned.join('/')}`;
}

// Re-export farms so the UI can list them in the finish dropdown.
export const farms = farmsRaw as Farm[];

export function getActiveFarmsWithCoords(): Farm[] {
  return farms.filter(f => f.active && getFarmCoordinates(f.id) !== null);
}

export function getActiveStartLocationsWithCoords(): StartLocation[] {
  return startLocations.filter(s => s.active && getStartCoordinates(s.id) !== null);
}
