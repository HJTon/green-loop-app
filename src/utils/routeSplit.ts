// Splitting a too-big day into two van runs.
//
// Objective ("balance both", per the product decision): aim for one *full* run
// (close to the 12-bin capacity) and one lighter run, while keeping each run
// geographically tight so neither involves needless driving. Only bins count
// toward capacity; buckets/soil ride along in spare space and are assigned to
// whichever run is geographically nearer.
//
// The work is cheap (n is small — a day is at most a couple dozen stops), so we
// generate a handful of candidate partitions from geographic orderings, optimise
// each side over a shared road matrix, and keep the lowest-scoring feasible one.

import { haversineKm, optimiseSubsetByRoad, type SubsetOptimiseResult } from './routeOptimiser';

type Coord = { lat: number; lng: number };

export interface SplitStop {
  id: string;
  coord: Coord;
  bins: number;       // capacity contribution (0 for buckets/soil)
  matrixIdx: number;  // this stop's row/col in the shared road matrix
}

export interface RunPlan {
  ids: string[];      // ordered stop ids
  bins: number;
  seconds: number;
  meters: number;
}

export interface SplitSuggestion {
  run1: RunPlan;      // the fuller run (≤ capacity when feasible)
  run2: RunPlan;
  // false when no partition keeps a run at/under capacity (e.g. a single stop
  // already exceeds it). We still return a best-effort split for the driver to
  // edit, but the UI should warn.
  feasible: boolean;
}

export interface SuggestSplitParams {
  stops: SplitStop[];
  matrix: { durations: number[][]; distances: number[][] };
  run1Start: number;
  run1End: number;
  run2Start: number;
  run2End: number;
  capacity: number;
}

// Seconds of driving we're willing to "pay" per empty bin slot left on run 1.
// Tuned so that filling the van is rewarded but never at the cost of a big
// geographic detour. 60s ≈ a minute of extra driving per unfilled slot.
const LAMBDA_PER_EMPTY_SLOT = 60;

function centroid(coords: Coord[]): Coord {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const c of coords) {
    lat += c.lat;
    lng += c.lng;
  }
  return { lat: lat / coords.length, lng: lng / coords.length };
}

// Candidate 1-D orderings of the stops. A cut point along any of these gives a
// contiguous geographic partition. We use an angular sweep, the principal axis
// (best straight-line divider), and the two axis-aligned orders.
function candidateOrderings(stops: SplitStop[]): SplitStop[][] {
  const c = centroid(stops.map(s => s.coord));

  const sweep = [...stops].sort(
    (a, b) =>
      Math.atan2(a.coord.lat - c.lat, a.coord.lng - c.lng) -
      Math.atan2(b.coord.lat - c.lat, b.coord.lng - c.lng)
  );

  // Principal axis via the 2×2 coordinate covariance.
  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  for (const s of stops) {
    const dx = s.coord.lng - c.lng;
    const dy = s.coord.lat - c.lat;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ax = Math.cos(theta);
  const ay = Math.sin(theta);
  const principal = [...stops].sort(
    (a, b) =>
      ((a.coord.lng - c.lng) * ax + (a.coord.lat - c.lat) * ay) -
      ((b.coord.lng - c.lng) * ax + (b.coord.lat - c.lat) * ay)
  );

  const byLng = [...stops].sort((a, b) => a.coord.lng - b.coord.lng);
  const byLat = [...stops].sort((a, b) => a.coord.lat - b.coord.lat);

  return [sweep, principal, byLng, byLat];
}

function optimiseRun(
  runStops: SplitStop[],
  start: number,
  end: number,
  matrix: SuggestSplitParams['matrix']
): RunPlan {
  const byMatrixIdx = new Map(runStops.map(s => [s.matrixIdx, s]));
  const res: SubsetOptimiseResult = optimiseSubsetByRoad(
    matrix,
    start,
    end,
    runStops.map(s => s.matrixIdx)
  );
  return {
    ids: res.orderedStopIdxs.map(idx => byMatrixIdx.get(idx)!.id),
    bins: runStops.reduce((sum, s) => sum + s.bins, 0),
    seconds: res.totalSeconds,
    meters: res.totalMeters,
  };
}

// Assign rider stops (buckets/soil — zero bins) to whichever run's centroid is
// nearer, so they don't drag the driver across town.
function assignRiders(
  riders: SplitStop[],
  side1: SplitStop[],
  side2: SplitStop[]
): { side1: SplitStop[]; side2: SplitStop[] } {
  const c1 = centroid(side1.map(s => s.coord));
  const c2 = centroid(side2.map(s => s.coord));
  const out1 = [...side1];
  const out2 = [...side2];
  for (const r of riders) {
    if (haversineKm(r.coord, c1) <= haversineKm(r.coord, c2)) out1.push(r);
    else out2.push(r);
  }
  return { side1: out1, side2: out2 };
}

export function suggestSplit(params: SuggestSplitParams): SplitSuggestion {
  const { stops, matrix, run1Start, run1End, run2Start, run2End, capacity } = params;

  const binStops = stops.filter(s => s.bins > 0);
  const riderStops = stops.filter(s => s.bins === 0);

  let best: { score: number; run1: RunPlan; run2: RunPlan } | null = null;
  let anyFeasible = false;

  const consider = (rawSide1: SplitStop[], rawSide2: SplitStop[]) => {
    if (rawSide1.length === 0 || rawSide2.length === 0) return;
    const bins1 = rawSide1.reduce((s, x) => s + x.bins, 0);
    if (bins1 > capacity) return; // run 1 must be the (≤ capacity) full van
    anyFeasible = true;

    const { side1, side2 } = assignRiders(riderStops, rawSide1, rawSide2);
    const run1 = optimiseRun(side1, run1Start, run1End, matrix);
    const run2 = optimiseRun(side2, run2Start, run2End, matrix);
    const score =
      run1.seconds + run2.seconds + LAMBDA_PER_EMPTY_SLOT * Math.max(0, capacity - bins1);
    if (!best || score < best.score) best = { score, run1, run2 };
  };

  for (const ordering of candidateOrderings(binStops)) {
    for (let k = 1; k < ordering.length; k++) {
      const a = ordering.slice(0, k);
      const b = ordering.slice(k);
      // Try each side as run 1 — the LAMBDA reward naturally favours the fuller
      // feasible side, but both must be tested since either may be ≤ capacity.
      consider(a, b);
      consider(b, a);
    }
  }

  if (best) {
    const chosen = best as { score: number; run1: RunPlan; run2: RunPlan };
    return { run1: chosen.run1, run2: chosen.run2, feasible: anyFeasible };
  }

  // No feasible partition (e.g. one stop alone exceeds capacity). Fall back to a
  // straight half-and-half by the principal axis so the planner still renders
  // something the driver can hand-edit, and flag it as not-feasible.
  const ordering = candidateOrderings(binStops)[1] ?? binStops;
  const mid = Math.max(1, Math.floor(ordering.length / 2));
  const { side1, side2 } = assignRiders(
    riderStops,
    ordering.slice(0, mid),
    ordering.slice(mid)
  );
  return {
    run1: optimiseRun(side1, run1Start, run1End, matrix),
    run2: optimiseRun(side2, run2Start, run2End, matrix),
    feasible: false,
  };
}
