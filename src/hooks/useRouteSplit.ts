// Powers the two-run split planner.
//
// Fetches a SINGLE road matrix over the union of every point the planner could
// need — all active start locations, every located stop, and all active farms —
// so that dragging stops between runs OR changing a run's start/finish never
// triggers another ORS call. Everything (the auto-suggestion and per-run
// recompute while editing) slices that one cached matrix.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Client, RouteStop, RunEndpoints } from '@/types';
import {
  getStartCoordinates,
  getFarmCoordinates,
  getClientCoordinates,
  getActiveStartLocationsWithCoords,
  getActiveFarmsWithCoords,
  optimiseSubsetByRoad,
} from '@/utils/routeOptimiser';
import { suggestSplit, type SplitStop, type SplitSuggestion, type RunPlan } from '@/utils/routeSplit';
import { binLoad, BIN_CAPACITY } from '@/utils/vanLoad';
import { ensureGeocoded } from '@/utils/geocodeCache';
import { fetchRoadMatrix, getCachedMatrix, type RoadMatrix, type Coord } from '@/utils/roadMatrix';

export type SplitStatus = 'idle' | 'geocoding' | 'fetching' | 'ready' | 'unavailable';

export interface UseRouteSplitResult {
  status: SplitStatus;
  located: { id: string; client: Client; bins: number }[];
  missing: Client[];
  totalBins: number;
  // Auto-suggest a balanced two-run split for the given per-run endpoints.
  suggest: (endpoints: { run1: RunEndpoints; run2: RunEndpoints }) => SplitSuggestion | null;
  // Optimise one run's exact stop-id set against its endpoints (used live while
  // the driver edits the split). Returns null if the matrix isn't ready.
  planRun: (ids: string[], endpoints: RunEndpoints) => RunPlan | null;
  isFetching: boolean;
  error: string | null;
}

interface UseRouteSplitParams {
  stops: RouteStop[];
  getClientById: (id: string) => Client | undefined;
  enabled?: boolean;
}

export function useRouteSplit({
  stops,
  getClientById,
  enabled = true,
}: UseRouteSplitParams): UseRouteSplitResult {
  const [geocodeTick, setGeocodeTick] = useState(0);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [matrix, setMatrix] = useState<RoadMatrix | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKeyRef = useRef('');

  const startOptions = useMemo(() => getActiveStartLocationsWithCoords(), []);
  const farmOptions = useMemo(() => getActiveFarmsWithCoords(), []);

  // Lazy geocode any pending stop with an address but no coord yet.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const needsGeocode: string[] = [];
    for (const stop of stops) {
      if (stop.status !== 'pending') continue;
      const client = getClientById(stop.client_id);
      if (!client || !client.address) continue;
      if (getClientCoordinates(client) == null) needsGeocode.push(client.address);
    }
    if (needsGeocode.length === 0) {
      setIsGeocoding(false);
      return;
    }
    setIsGeocoding(true);
    ensureGeocoded(needsGeocode).then(() => {
      if (cancelled) return;
      setIsGeocoding(false);
      setGeocodeTick(t => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, stops, getClientById]);

  // Located pending stops (sorted by id for a stable matrix cache key).
  const located = useMemo(() => {
    const out: { id: string; client: Client; coord: Coord; bins: number }[] = [];
    for (const stop of stops) {
      if (stop.status !== 'pending') continue;
      const client = getClientById(stop.client_id);
      if (!client) continue;
      const coord = getClientCoordinates(client);
      if (!coord) continue;
      out.push({ id: stop.client_id, client, coord, bins: binLoad(client) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }, [stops, getClientById, geocodeTick]);

  const missing = useMemo(() => {
    const out: Client[] = [];
    for (const stop of stops) {
      if (stop.status !== 'pending') continue;
      const client = getClientById(stop.client_id);
      if (!client) continue;
      if (getClientCoordinates(client) == null) out.push(client);
    }
    return out;
  }, [stops, getClientById, geocodeTick]);

  // Union point set + index lookups. Layout: [starts..., stops..., farms...].
  const { points, stopIdx, startIdx, farmIdx } = useMemo(() => {
    const pts: Coord[] = [];
    const sIdx = new Map<string, number>();
    const stIdx = new Map<string, number>();
    const fIdx = new Map<string, number>();
    for (const s of startOptions) {
      const c = getStartCoordinates(s.id);
      if (!c) continue;
      sIdx.set(s.id, pts.length);
      pts.push(c);
    }
    for (const l of located) {
      stIdx.set(l.id, pts.length);
      pts.push(l.coord);
    }
    for (const f of farmOptions) {
      const c = getFarmCoordinates(f.id);
      if (!c) continue;
      fIdx.set(f.id, pts.length);
      pts.push(c);
    }
    return { points: pts, stopIdx: stIdx, startIdx: sIdx, farmIdx: fIdx };
  }, [located, startOptions, farmOptions]);

  // Fetch (or reuse cached) matrix whenever the point set changes.
  useEffect(() => {
    if (!enabled) return;
    if (located.length === 0 || points.length < 2) {
      setMatrix(null);
      setIsFetching(false);
      return;
    }
    const requestKey = points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
    requestKeyRef.current = requestKey;
    setMatrix(null);

    const cached = getCachedMatrix(points);
    if (cached) {
      setMatrix(cached);
      setError(null);
      setIsFetching(false);
      return;
    }

    let cancelled = false;
    setIsFetching(true);
    setError(null);
    fetchRoadMatrix(points)
      .then(m => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        setMatrix(m);
        setError(null);
      })
      .catch(err => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        console.warn('Split road matrix fetch failed:', err);
        setMatrix(null);
        setError(err?.message || 'Road distance unavailable');
      })
      .finally(() => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        setIsFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, points, located.length]);

  const matrixFits = matrix != null && matrix.durations.length === points.length;

  const planRun = useCallback(
    (ids: string[], endpoints: RunEndpoints): RunPlan | null => {
      if (!matrix || !matrixFits) return null;
      const s = startIdx.get(endpoints.startId);
      const e = farmIdx.get(endpoints.finishId);
      if (s == null || e == null) return null;

      const runStops = ids
        .map(id => {
          const idx = stopIdx.get(id);
          const l = located.find(x => x.id === id);
          if (idx == null || !l) return null;
          return { id, matrixIdx: idx, bins: l.bins };
        })
        .filter((x): x is { id: string; matrixIdx: number; bins: number } => x != null);

      const byMatrixIdx = new Map(runStops.map(r => [r.matrixIdx, r]));
      const res = optimiseSubsetByRoad(matrix, s, e, runStops.map(r => r.matrixIdx));
      return {
        ids: res.orderedStopIdxs.map(idx => byMatrixIdx.get(idx)!.id),
        bins: runStops.reduce((sum, r) => sum + r.bins, 0),
        seconds: res.totalSeconds,
        meters: res.totalMeters,
      };
    },
    [matrix, matrixFits, startIdx, farmIdx, stopIdx, located]
  );

  const suggest = useCallback(
    (endpoints: { run1: RunEndpoints; run2: RunEndpoints }): SplitSuggestion | null => {
      if (!matrix || !matrixFits) return null;
      const r1s = startIdx.get(endpoints.run1.startId);
      const r1e = farmIdx.get(endpoints.run1.finishId);
      const r2s = startIdx.get(endpoints.run2.startId);
      const r2e = farmIdx.get(endpoints.run2.finishId);
      if (r1s == null || r1e == null || r2s == null || r2e == null) return null;

      const splitStops: SplitStop[] = located.map(l => ({
        id: l.id,
        coord: l.coord,
        bins: l.bins,
        matrixIdx: stopIdx.get(l.id)!,
      }));
      return suggestSplit({
        stops: splitStops,
        matrix,
        run1Start: r1s,
        run1End: r1e,
        run2Start: r2s,
        run2End: r2e,
        capacity: BIN_CAPACITY,
      });
    },
    [matrix, matrixFits, startIdx, farmIdx, stopIdx, located]
  );

  const totalBins = useMemo(() => located.reduce((sum, l) => sum + l.bins, 0), [located]);

  let status: SplitStatus = 'idle';
  if (!enabled) status = 'idle';
  else if (located.length === 0 && missing.length === 0 && !isGeocoding) status = 'idle';
  else if (isGeocoding) status = 'geocoding';
  else if (isFetching || !matrix) status = error ? 'unavailable' : 'fetching';
  else if (matrixFits) status = 'ready';
  else status = 'unavailable';

  return {
    status,
    located: located.map(l => ({ id: l.id, client: l.client, bins: l.bins })),
    missing,
    totalBins,
    suggest,
    planRun,
    isFetching: isFetching || isGeocoding,
    error,
  };
}
