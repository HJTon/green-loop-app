// Drives the auto-optimisation pipeline for a route:
//   1. Lazily geocode any stops whose addresses aren't cached.
//   2. Fetch (or pull from cache) an N×N road-travel-time matrix from ORS.
//   3. Run Held-Karp on driving seconds, with fixed start + finish.
//
// The hook is non-destructive — it only computes. Applying the optimal order
// to the actual route is the caller's responsibility (the RouteListPage
// applies it once per route ID so subsequent manual reorders aren't clobbered).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client, RouteStop } from '@/types';
import {
  getStartCoordinates,
  getFarmCoordinates,
  getClientCoordinates,
  optimiseRouteByRoad,
  roadCostForOrder,
} from '@/utils/routeOptimiser';
import { ensureGeocoded, retryGeocode } from '@/utils/geocodeCache';
import { fetchRoadMatrix, getCachedMatrix, type RoadMatrix } from '@/utils/roadMatrix';

export type OptimisationStatus =
  | 'idle'           // nothing to do (no stops, no endpoints)
  | 'geocoding'      // looking up addresses
  | 'fetching'       // fetching road matrix
  | 'ready'          // optimal order available
  | 'unavailable';   // couldn't fetch matrix and no fallback wanted by caller

export interface UseOptimalRouteResult {
  status: OptimisationStatus;
  // Stops eligible for optimisation (pending + located).
  located: { id: string; client: Client }[];
  // Stops we couldn't place (no address / geocoding failed).
  missing: Client[];
  // Optimal ordering of located stop IDs (start/finish implied).
  optimalIds: string[];
  optimalSeconds: number;
  optimalMeters: number;
  // Compute driving cost for an arbitrary ordering of stop IDs.
  // Returns null if the matrix isn't available or any ID isn't in `located`.
  costForOrder: (orderedIds: string[]) => { seconds: number; meters: number } | null;
  // Force a fresh geocode for one address — clears its cache entry, runs the
  // full Nominatim->Photon chain again, then re-triggers the hook so located/
  // missing/optimisation re-derive. Resolves with the new coord (or null if
  // every geocoder still misses).
  retryGeocodeFor: (address: string) => Promise<{ lat: number; lng: number } | null>;
  // True while the matrix is still being fetched (use for spinners).
  isFetching: boolean;
  error: string | null;
}

interface UseOptimalRouteParams {
  stops: RouteStop[];
  getClientById: (id: string) => Client | undefined;
  startId: string;
  finishId: string;
  enabled?: boolean;
}

export function useOptimalRoute({
  stops,
  getClientById,
  startId,
  finishId,
  enabled = true,
}: UseOptimalRouteParams): UseOptimalRouteResult {
  const [geocodeTick, setGeocodeTick] = useState(0);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [matrix, setMatrix] = useState<RoadMatrix | null>(null);
  const [isFetchingMatrix, setIsFetchingMatrix] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKeyRef = useRef<string>('');

  // Effect 1 — lazy geocode for stops with addresses but no coords.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const needsGeocode: string[] = [];
    for (const stop of stops) {
      if (stop.status !== 'pending') continue;
      const client = getClientById(stop.client_id);
      if (!client || !client.address) continue;
      if (getClientCoordinates(client) == null) {
        needsGeocode.push(client.address);
      }
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

  // Located stops (have a coord). Sorted by client_id so the matrix cache key
  // is stable across manual reorders — otherwise dragging would burn an ORS
  // call every time. The optimiser doesn't care what order we pass the stops
  // in; only that the indexing stays consistent.
  const located = useMemo(() => {
    const out: { id: string; client: Client; coord: { lat: number; lng: number } }[] = [];
    for (const stop of stops) {
      if (stop.status !== 'pending') continue;
      const client = getClientById(stop.client_id);
      if (!client) continue;
      const coord = getClientCoordinates(client);
      if (!coord) continue;
      out.push({ id: stop.client_id, client, coord });
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

  // Effect 2 — fetch road matrix for [start, ...located, end].
  useEffect(() => {
    if (!enabled) return;
    const start = getStartCoordinates(startId);
    const end = getFarmCoordinates(finishId);
    if (!start || !end || located.length === 0) {
      setMatrix(null);
      setIsFetchingMatrix(false);
      return;
    }

    const points = [start, ...located.map(l => l.coord), end];
    const requestKey = points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
    requestKeyRef.current = requestKey;

    // Invalidate any stale (different-size) matrix so the planner can't
    // index out of bounds while we wait for the new one.
    setMatrix(null);

    const cached = getCachedMatrix(points);
    if (cached) {
      setMatrix(cached);
      setError(null);
      setIsFetchingMatrix(false);
      return;
    }

    let cancelled = false;
    setIsFetchingMatrix(true);
    setError(null);
    fetchRoadMatrix(points)
      .then(m => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        setMatrix(m);
        setError(null);
      })
      .catch(err => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        console.warn('Road matrix fetch failed:', err);
        setMatrix(null);
        setError(err?.message || 'Road distance unavailable');
      })
      .finally(() => {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        setIsFetchingMatrix(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, startId, finishId, located]);

  // Optimal ordering and cost — derived from the matrix.
  const optimisation = useMemo(() => {
    const expectedSize = located.length + 2;
    if (
      !matrix ||
      matrix.durations.length !== expectedSize ||
      matrix.durations[0]?.length !== expectedSize ||
      located.length === 0
    ) {
      return null;
    }
    const start = getStartCoordinates(startId);
    const end = getFarmCoordinates(finishId);
    if (!start || !end) return null;

    return optimiseRouteByRoad(
      { start, end, stops: located.map(l => ({ id: l.id, coord: l.coord })) },
      matrix
    );
  }, [located, matrix, startId, finishId]);

  const costForOrder = useMemo(() => {
    return (orderedIds: string[]): { seconds: number; meters: number } | null => {
      if (!matrix || located.length === 0) return null;
      const expectedSize = located.length + 2;
      if (matrix.durations.length !== expectedSize) return null;

      const indices: number[] = [];
      for (const id of orderedIds) {
        const idx = located.findIndex(l => l.id === id);
        if (idx === -1) return null;
        indices.push(idx);
      }
      if (indices.length !== located.length) return null;
      return roadCostForOrder(indices, matrix);
    };
  }, [matrix, located]);

  let status: OptimisationStatus = 'idle';
  if (!enabled) status = 'idle';
  else if (located.length === 0 && missing.length === 0 && !isGeocoding) status = 'idle';
  else if (isGeocoding) status = 'geocoding';
  else if (isFetchingMatrix || !matrix) {
    status = error ? 'unavailable' : 'fetching';
  } else if (optimisation) {
    status = 'ready';
  } else {
    status = 'unavailable';
  }

  const retryGeocodeFor = async (
    address: string
  ): Promise<{ lat: number; lng: number } | null> => {
    const coord = await retryGeocode(address);
    // Bump the geocode tick so `located` / `missing` re-derive from the now
    // up-to-date cache. The route matrix effect will then pick up the new
    // point set and re-fetch ORS if needed.
    setGeocodeTick(t => t + 1);
    return coord;
  };

  return {
    status,
    located: located.map(l => ({ id: l.id, client: l.client })),
    missing,
    optimalIds: optimisation?.orderedIds ?? [],
    optimalSeconds: optimisation?.totalSeconds ?? 0,
    optimalMeters: optimisation?.totalMeters ?? 0,
    costForOrder,
    retryGeocodeFor,
    isFetching: isFetchingMatrix || isGeocoding,
    error,
  };
}
