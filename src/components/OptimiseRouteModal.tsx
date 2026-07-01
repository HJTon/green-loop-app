import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Navigation, X, AlertCircle, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from './Button';
import type { Client, RouteStop } from '@/types';
import {
  optimiseRoute,
  optimiseRouteByRoad,
  roadCostForOrder,
  routeDistanceKm,
  buildGoogleMapsUrl,
  getStartCoordinates,
  getFarmCoordinates,
  getClientCoordinates,
  getActiveFarmsWithCoords,
  getActiveStartLocationsWithCoords,
} from '@/utils/routeOptimiser';
import { ensureGeocoded } from '@/utils/geocodeCache';
import { fetchRoadMatrix, getCachedMatrix, type RoadMatrix } from '@/utils/roadMatrix';

interface OptimiseRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  stops: RouteStop[];
  getClientById: (id: string) => Client | undefined;
  destinationFarmId?: string;
  // Controlled start/finish selection — when these props are provided the
  // modal mirrors the parent state instead of holding its own.
  startId?: string;
  finishId?: string;
  onChangeStart?: (id: string) => void;
  onChangeFinish?: (id: string) => void;
  onApplyOrder?: (orderedClientIds: string[]) => void;
}

// Format seconds into "Hh Mm" or "Mm" — easier to read at a glance than raw minutes.
function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function OptimiseRouteModal({
  isOpen,
  onClose,
  stops,
  getClientById,
  destinationFarmId,
  startId: startIdProp,
  finishId: finishIdProp,
  onChangeStart,
  onChangeFinish,
  onApplyOrder,
}: OptimiseRouteModalProps) {
  const startOptions = useMemo(() => getActiveStartLocationsWithCoords(), []);
  const farmOptions = useMemo(() => getActiveFarmsWithCoords(), []);

  // Local fallback state for uncontrolled usage.
  const [localStartId, setLocalStartId] = useState<string>(startOptions[0]?.id ?? '');
  const [localFinishId, setLocalFinishId] = useState<string>(
    destinationFarmId && farmOptions.some(f => f.id === destinationFarmId)
      ? destinationFarmId
      : farmOptions[0]?.id ?? ''
  );
  const startId = startIdProp ?? localStartId;
  const finishId = finishIdProp ?? localFinishId;
  const setStartId = (id: string) => {
    if (onChangeStart) onChangeStart(id);
    else setLocalStartId(id);
  };
  const setFinishId = (id: string) => {
    if (onChangeFinish) onChangeFinish(id);
    else setLocalFinishId(id);
  };

  // Tick state to force recompute after async fetches settle.
  const [geocodeTick, setGeocodeTick] = useState(0);
  const [pendingGeocodeCount, setPendingGeocodeCount] = useState(0);

  // Road matrix state — null until fetched (or until we know it's unavailable).
  const [roadMatrix, setRoadMatrix] = useState<RoadMatrix | null>(null);
  const [isFetchingMatrix, setIsFetchingMatrix] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const matrixRequestKeyRef = useRef<string>('');

  // 1) When the modal opens, lazily geocode any addresses missing from cache.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const pendingStops = stops.filter(s => s.status === 'pending');
    const needsGeocode: string[] = [];
    for (const stop of pendingStops) {
      const client = getClientById(stop.client_id);
      if (!client || !client.address) continue;
      if (getClientCoordinates(client) == null) {
        needsGeocode.push(client.address);
      }
    }

    if (needsGeocode.length === 0) {
      setPendingGeocodeCount(0);
      return;
    }

    setPendingGeocodeCount(needsGeocode.length);
    ensureGeocoded(needsGeocode).then(() => {
      if (cancelled) return;
      setPendingGeocodeCount(0);
      setGeocodeTick(t => t + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, stops, getClientById]);

  // Located stops, in the order they currently appear on the route. Memoised
  // separately from `plan` so the matrix fetch effect can depend on it directly.
  const located = useMemo(() => {
    if (!isOpen) return [];
    const pendingStops = stops.filter(s => s.status === 'pending').sort((a, b) => a.position - b.position);
    const out: { id: string; client: Client; coord: { lat: number; lng: number } }[] = [];
    for (const stop of pendingStops) {
      const client = getClientById(stop.client_id);
      if (!client) continue;
      const coord = getClientCoordinates(client);
      if (!coord) continue;
      out.push({ id: stop.client_id, client, coord });
    }
    return out;
  }, [isOpen, stops, getClientById, geocodeTick]);

  const missing = useMemo(() => {
    if (!isOpen) return [];
    const pendingStops = stops.filter(s => s.status === 'pending');
    const out: Client[] = [];
    for (const stop of pendingStops) {
      const client = getClientById(stop.client_id);
      if (!client) continue;
      if (getClientCoordinates(client) == null) out.push(client);
    }
    return out;
  }, [isOpen, stops, getClientById, geocodeTick]);

  // 2) Once we have endpoints + located stops, fetch the road-distance matrix.
  // Re-runs whenever the set of points changes (e.g. start/finish swap, or a
  // newly-geocoded stop joins the route).
  useEffect(() => {
    if (!isOpen) return;
    const start = getStartCoordinates(startId);
    const end = getFarmCoordinates(finishId);
    if (!start || !end || located.length === 0) {
      setRoadMatrix(null);
      return;
    }

    const points = [start, ...located.map(l => l.coord), end];
    const requestKey = points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
    matrixRequestKeyRef.current = requestKey;

    // Cache hit → use immediately without flashing the spinner.
    const cached = getCachedMatrix(points);
    if (cached) {
      setRoadMatrix(cached);
      setMatrixError(null);
      setIsFetchingMatrix(false);
      return;
    }

    // Invalidate stale matrix from a previous (different-sized) point set so
    // the planner doesn't try to index into the wrong dimensions.
    setRoadMatrix(null);

    let cancelled = false;
    setIsFetchingMatrix(true);
    setMatrixError(null);
    fetchRoadMatrix(points)
      .then(matrix => {
        if (cancelled || matrixRequestKeyRef.current !== requestKey) return;
        setRoadMatrix(matrix);
        setMatrixError(null);
      })
      .catch(err => {
        if (cancelled || matrixRequestKeyRef.current !== requestKey) return;
        console.warn('Road matrix fetch failed, falling back to straight-line:', err);
        setRoadMatrix(null);
        setMatrixError(err?.message || 'Road distance unavailable');
      })
      .finally(() => {
        if (cancelled || matrixRequestKeyRef.current !== requestKey) return;
        setIsFetchingMatrix(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, startId, finishId, located]);

  // 3) Compute the plan — prefer road-time optimisation, fall back to haversine.
  const plan = useMemo(() => {
    if (!isOpen) return null;
    const start = getStartCoordinates(startId);
    const end = getFarmCoordinates(finishId);
    if (!start || !end) return null;
    if (located.length === 0) {
      return {
        mode: 'empty' as const,
        start,
        end,
      };
    }

    // Sanity check: matrix must be sized for [start, ...located, end].
    const expectedSize = located.length + 2;
    const matrixFits =
      roadMatrix != null &&
      roadMatrix.durations.length === expectedSize &&
      roadMatrix.durations[0]?.length === expectedSize;

    if (matrixFits && roadMatrix) {
      const optimised = optimiseRouteByRoad(
        { start, end, stops: located.map(l => ({ id: l.id, coord: l.coord })) },
        roadMatrix
      );
      // The matrix rows are [start, located[0], located[1], ..., end]; the current
      // order matches `located` indices 0..n-1 directly.
      const current = roadCostForOrder(
        located.map((_, i) => i),
        roadMatrix
      );
      return {
        mode: 'road' as const,
        start,
        end,
        orderedIds: optimised.orderedIds,
        currentSeconds: current.seconds,
        currentMeters: current.meters,
        optimisedSeconds: optimised.totalSeconds,
        optimisedMeters: optimised.totalMeters,
      };
    }

    // Haversine fallback.
    const currentKm = routeDistanceKm(start, end, located.map(l => l.coord));
    const optimised = optimiseRoute({
      start,
      end,
      stops: located.map(l => ({ id: l.id, coord: l.coord })),
    });
    return {
      mode: 'haversine' as const,
      start,
      end,
      orderedIds: optimised.orderedIds,
      currentKm,
      optimisedKm: optimised.totalKm,
    };
  }, [isOpen, startId, finishId, located, roadMatrix]);

  // Resolve optimised IDs → client objects. Must be a hook (so before the
  // early return below) to satisfy Rules of Hooks across open/close toggles.
  const orderedClients = useMemo<Client[]>(() => {
    if (!plan || plan.mode === 'empty') return [];
    return plan.orderedIds
      .map(id => located.find(l => l.id === id)?.client)
      .filter((c): c is Client => c != null);
  }, [plan, located]);

  if (!isOpen) return null;

  const startLocation = startOptions.find(s => s.id === startId);
  const finishFarm = farmOptions.find(f => f.id === finishId);

  const handleOpenInMaps = () => {
    if (!orderedClients.length || !startLocation || !finishFarm) return;
    const url = buildGoogleMapsUrl([
      startLocation.address,
      ...orderedClients.map(c => c.address),
      finishFarm.address,
    ]);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleApply = () => {
    if (!plan || plan.mode === 'empty' || !onApplyOrder) return;
    onApplyOrder(plan.orderedIds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-green-primary" />
            <h2 className="text-lg font-semibold text-gray-900">Suggested Route</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 -mr-1 text-gray-500 hover:text-gray-800"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Start / Finish pickers */}
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Start from</span>
              <select
                value={startId}
                onChange={e => setStartId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-green-primary focus:ring-1 focus:ring-green-primary"
              >
                {startOptions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.address}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Finish at</span>
              <select
                value={finishId}
                onChange={e => setFinishId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-green-primary focus:ring-1 focus:ring-green-primary"
              >
                {farmOptions.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.farm_name} — {f.address}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Geocoding in progress */}
          {pendingGeocodeCount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2 items-center">
              <Loader2 size={18} className="text-blue-600 shrink-0 animate-spin" />
              <p className="text-sm text-blue-900">
                Looking up {pendingGeocodeCount} new address{pendingGeocodeCount === 1 ? '' : 'es'}…
              </p>
            </div>
          )}

          {/* Fetching road matrix */}
          {isFetchingMatrix && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2 items-center">
              <Loader2 size={18} className="text-blue-600 shrink-0 animate-spin" />
              <p className="text-sm text-blue-900">Calculating real driving times…</p>
            </div>
          )}

          {/* Distance / time summary */}
          {plan && plan.mode === 'road' && (
            <div className="bg-lime-50 border border-lime-accent rounded-xl p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">Suggested drive</span>
                <span className="text-xl font-bold text-green-dark">
                  {formatDuration(plan.optimisedSeconds)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {(plan.optimisedMeters / 1000).toFixed(1)} km of road
              </p>
              {plan.currentSeconds - plan.optimisedSeconds > 30 && (
                <div className="flex items-center gap-1 text-xs text-green-dark mt-1">
                  <span className="line-through text-gray-400">{formatDuration(plan.currentSeconds)}</span>
                  <ArrowRight size={12} />
                  <span>
                    saves {formatDuration(plan.currentSeconds - plan.optimisedSeconds)}
                    {' '}({Math.round(((plan.currentSeconds - plan.optimisedSeconds) / plan.currentSeconds) * 100)}%) vs current order
                  </span>
                </div>
              )}
              {plan.currentSeconds - plan.optimisedSeconds <= 30 && (
                <p className="text-xs text-gray-500 mt-1">Current order is already optimal.</p>
              )}
            </div>
          )}

          {plan && plan.mode === 'haversine' && (
            <div className="bg-lime-50 border border-lime-accent rounded-xl p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">Suggested distance</span>
                <span className="text-xl font-bold text-green-dark">{plan.optimisedKm.toFixed(1)} km</span>
              </div>
              {plan.currentKm - plan.optimisedKm > 0.05 && (
                <div className="flex items-center gap-1 text-xs text-green-dark mt-1">
                  <span className="line-through text-gray-400">{plan.currentKm.toFixed(1)} km</span>
                  <ArrowRight size={12} />
                  <span>
                    saves {(plan.currentKm - plan.optimisedKm).toFixed(1)} km
                    {' '}({Math.round(((plan.currentKm - plan.optimisedKm) / plan.currentKm) * 100)}%) vs current order
                  </span>
                </div>
              )}
              <p className="text-[11px] text-amber-700 mt-2">
                ⚠ Straight-line estimate {matrixError ? '(road network unavailable)' : ''}.
                Real drive times may differ in NP — bridges, one-ways, etc.
              </p>
            </div>
          )}

          {/* No located stops */}
          {plan && plan.mode === 'empty' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900">
                No pending stops to order. Either everything is complete, or none of today's
                stops have known coordinates yet.
              </p>
            </div>
          )}

          {/* Missing coords warning */}
          {missing.length > 0 && pendingGeocodeCount === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">Couldn't place these stops:</p>
                <ul className="list-disc list-inside mt-1">
                  {missing.map(c => (
                    <li key={c.id}>
                      {c.business_name}
                      {!c.address ? ' (no address on file)' : ' (address not found)'}
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-1">
                  Add a street address in the sheet and refresh.
                </p>
              </div>
            </div>
          )}

          {/* Ordered list */}
          {orderedClients.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Suggested order
              </p>
              <ol className="space-y-1.5">
                <li className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin size={14} className="text-green-primary" />
                  <span className="font-medium">Start: {startLocation?.name}</span>
                </li>
                {orderedClients.map((client, i) => (
                  <li key={client.id} className="flex items-start gap-2 text-sm text-gray-800">
                    <span className="w-5 h-5 rounded-full bg-green-primary text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span>{client.business_name}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin size={14} className="text-lime-accent" />
                  <span className="font-medium">Finish: {finishFarm?.farm_name}</span>
                </li>
              </ol>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={handleOpenInMaps}
              disabled={orderedClients.length === 0}
              className="w-full"
            >
              <Navigation size={18} className="mr-2" />
              Open in Google Maps
            </Button>
            {onApplyOrder && plan && plan.mode !== 'empty' && (
              <Button onClick={handleApply} variant="outline" className="w-full">
                Apply this order to my route
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

