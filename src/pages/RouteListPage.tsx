import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Header } from '@/components/Header';
import { ProgressBar } from '@/components/ProgressBar';
import { SortableStopCard } from '@/components/SortableStopCard';
import { Button } from '@/components/Button';
import { AddPickupButton } from '@/components/AddPickupButton';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { DatePickerModal } from '@/components/DatePickerModal';
import { OptimiseRouteModal } from '@/components/OptimiseRouteModal';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import { getCurrentDate } from '@/utils/storage';
import {
  MapPin, Trophy, Truck, Calendar, AlertCircle, ArrowLeft, RefreshCw, Package,
  Loader2, Navigation, Sparkles, Settings,
} from 'lucide-react';
import { useOptimalRoute } from '@/hooks/useOptimalRoute';
import {
  buildGoogleMapsUrl,
  getActiveStartLocationsWithCoords,
  getActiveFarmsWithCoords,
} from '@/utils/routeOptimiser';

// v2 (Jun 2026): bumped from v1 to invalidate any route that was auto-applied
// while the silent-append-of-unlocated-stops bug was live. Routes recorded under
// v1 keep their (potentially poisoned) saved order until manually re-optimised;
// routes seeing v2 for the first time get a fresh auto-apply attempt and now
// refuse to apply unless every pending stop has been located.
const AUTO_APPLIED_KEY = 'greenloop:auto-optimised-routes:v2';

function loadAutoApplied(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTO_APPLIED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistAutoApplied(set: Set<string>): void {
  try {
    localStorage.setItem(AUTO_APPLIED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function RouteListPage() {
  const navigate = useNavigate();
  const {
    collector,
    route,
    completedCount,
    totalStops,
    reorderStops,
    applyStopOrder,
    allPickupsComplete,
    isLoading,
    loadError,
    selectedDate,
    isReadOnlyView,
    getClientById,
    setViewDate,
    availableDates,
    refreshData,
    addToast,
  } = useApp();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showOptimiser, setShowOptimiser] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Endpoint selection — defaults to the only Envirohub start and the route's
  // assigned destination farm. Can be overridden via the settings modal.
  const startOptions = useMemo(() => getActiveStartLocationsWithCoords(), []);
  const farmOptions = useMemo(() => getActiveFarmsWithCoords(), []);

  const [startId, setStartId] = useState<string>(startOptions[0]?.id ?? '');
  const [finishId, setFinishId] = useState<string>('');

  // Keep finishId in sync with whatever route is loaded, unless the user has
  // explicitly chosen one for this session.
  const userPickedFinishRef = useRef(false);
  useEffect(() => {
    if (userPickedFinishRef.current) return;
    if (!route) return;
    const fromRoute = route.destination_farm_id;
    if (fromRoute && farmOptions.some(f => f.id === fromRoute)) {
      setFinishId(fromRoute);
    } else if (farmOptions[0]) {
      setFinishId(farmOptions[0].id);
    }
  }, [route, farmOptions]);

  // Drive the optimisation pipeline. Disabled in read-only view (where editing
  // is off anyway) and when there's no route loaded yet.
  const optimisation = useOptimalRoute({
    stops: route?.stops ?? [],
    getClientById,
    startId,
    finishId,
    enabled: !!route && !isReadOnlyView && startId !== '' && finishId !== '',
  });

  // Auto-apply the optimal order ONCE per route ID, so manual reorders aren't
  // clobbered on every re-render or page revisit.
  //
  // CRITICAL: only auto-apply when EVERY pending stop is located. If any stop
  // has no coord (geocoder miss / Nominatim failure), it would otherwise be
  // silently appended at the end of the route by applyStopOrder, dragging the
  // driver back into town for a final pickup after they've already swept out
  // toward the farm. Refuse to apply in that case — the banner will warn the
  // driver and they can open the modal to investigate the unplaced stops.
  const autoAppliedRef = useRef<Set<string>>(loadAutoApplied());
  useEffect(() => {
    if (!route) return;
    if (optimisation.status !== 'ready') return;
    if (optimisation.optimalIds.length === 0) return;
    if (optimisation.missing.length > 0) return; // see note above
    if (autoAppliedRef.current.has(route.id)) return;

    // Check whether the current order already matches optimal — if so, just
    // record that we've "applied" and skip the toast.
    const sortedPending = route.stops
      .filter(s => s.status === 'pending')
      .sort((a, b) => a.position - b.position)
      .map(s => s.client_id);
    const optimalSet = new Set(optimisation.optimalIds);
    const currentPendingInOptimalSet = sortedPending.filter(id => optimalSet.has(id));
    const alreadyOptimal =
      currentPendingInOptimalSet.length === optimisation.optimalIds.length &&
      currentPendingInOptimalSet.every((id, i) => id === optimisation.optimalIds[i]);

    if (!alreadyOptimal) {
      applyStopOrder(optimisation.optimalIds);
      addToast('success', 'Route reordered to suggested driving order');
    }
    autoAppliedRef.current.add(route.id);
    persistAutoApplied(autoAppliedRef.current);
  }, [route, optimisation.status, optimisation.optimalIds, optimisation.missing.length, applyStopOrder, addToast]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!collector && !isLoading) {
      navigate('/');
    }
  }, [collector, isLoading, navigate]);

  // Format date for display (parse in local timezone to avoid day shift)
  const formatDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-NZ', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading route..." fullScreen />;
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 shadow-lg max-w-sm w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load Route</h2>
          <p className="text-sm text-gray-600 mb-4">{loadError}</p>
          <Button onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!collector || !route) {
    return null;
  }

  const destinationFarm = route.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;
  const allComplete = completedCount === totalStops;
  const sortedStops = [...route.stops].sort((a, b) => a.position - b.position);
  const startLocation = startOptions.find(s => s.id === startId);
  const finishFarm = farmOptions.find(f => f.id === finishId);

  // Compute "current order vs optimal" delta — only meaningful once ready.
  const currentPendingIds = sortedStops
    .filter(s => s.status === 'pending' && optimisation.located.some(l => l.id === s.client_id))
    .map(s => s.client_id);
  const currentCost = optimisation.status === 'ready' ? optimisation.costForOrder(currentPendingIds) : null;
  const deltaSeconds = currentCost && optimisation.optimalSeconds
    ? currentCost.seconds - optimisation.optimalSeconds
    : 0;

  // Whether the located stops are already in the optimal order. Used to decide
  // if the "Restore optimal" button has anything to do — independent of the
  // 10-second delta threshold, since after a manual drag we want drivers to be
  // able to snap back even when the cost difference is tiny.
  const currentOrderMatchesOptimal =
    optimisation.optimalIds.length > 0 &&
    currentPendingIds.length === optimisation.optimalIds.length &&
    currentPendingIds.every((id, i) => id === optimisation.optimalIds[i]);

  const handleStopClick = (clientId: string) => {
    if (isReadOnlyView) {
      return;
    }
    navigate(`/pickup/${clientId}`);
  };

  const handleViewSummary = () => {
    navigate('/summary');
  };

  const handleDropOff = () => {
    navigate('/dropoff');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReadOnlyView) return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedStops.findIndex(s => s.client_id === active.id);
      const newIndex = sortedStops.findIndex(s => s.client_id === over.id);
      reorderStops(oldIndex, newIndex);
    }
  };

  const handleBackToToday = () => {
    setViewDate(getCurrentDate(), false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshData();
      addToast('success', 'Route data refreshed');
    } catch {
      addToast('error', 'Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRestoreOptimal = () => {
    if (optimisation.optimalIds.length === 0) return;
    applyStopOrder(optimisation.optimalIds);
    addToast('success', 'Restored optimal order');
  };

  const handleOpenInMaps = () => {
    if (!startLocation || !finishFarm) return;
    // Only navigate to stops we haven't finished yet — driver doesn't want
    // turn-by-turn to places they've already visited.
    const orderedAddresses = sortedStops
      .filter(s => s.status === 'pending')
      .map(s => getClientById(s.client_id))
      .filter((c): c is NonNullable<typeof c> => c != null && !!c.address)
      .map(c => c.address);
    if (orderedAddresses.length === 0) {
      // Nothing pending — just go straight to the drop-off farm.
      const url = buildGoogleMapsUrl([startLocation.address, finishFarm.address]);
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const url = buildGoogleMapsUrl([
      startLocation.address,
      ...orderedAddresses,
      finishFarm.address,
    ]);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title={isReadOnlyView ? 'Viewing Schedule' : "Today's Route"} showLogout showSettings />

      {/* Read-only View Banner */}
      {isReadOnlyView && (
        <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-800">
                Viewing: {formatDisplayDate(selectedDate)}
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Read-only - cannot record pickups
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleBackToToday}>
              <ArrowLeft size={16} className="mr-1" />
              Today
            </Button>
          </div>
        </div>
      )}

      {/* Progress Section */}
      <div className="bg-white px-4 py-4 border-b border-gray-200">
        {!isReadOnlyView && (
          <ProgressBar
            current={completedCount}
            total={totalStops}
            label="Route Progress"
          />
        )}

        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MapPin size={16} className="text-green-primary" />
            <span>
              {isReadOnlyView
                ? `${totalStops} stops scheduled`
                : `Starting from: ${startLocation?.name ?? route.start_location}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {!isReadOnlyView && (
              <button
                onClick={() => navigate('/load-van')}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-green-primary transition-colors"
                title="Van loading summary"
              >
                <Package size={16} />
                <span>Load van</span>
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-green-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => setShowDatePicker(true)}
              className="flex items-center gap-1 text-sm text-green-primary hover:text-green-dark transition-colors"
            >
              <Calendar size={16} />
              <span>Other Days</span>
            </button>
          </div>
        </div>

        {/* Optimisation status banner */}
        {!isReadOnlyView && totalStops > 0 && (
          <div className="mt-3">
            <OptimisationBanner
              status={optimisation.status}
              optimalSeconds={optimisation.optimalSeconds}
              deltaSeconds={deltaSeconds}
              missingCount={optimisation.missing.length}
              error={optimisation.error}
              onOpenSettings={() => setShowOptimiser(true)}
              onRestoreOptimal={handleRestoreOptimal}
              canRestore={optimisation.optimalIds.length > 0 && !currentOrderMatchesOptimal}
            />
          </div>
        )}

        {!isReadOnlyView && totalStops > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            Drag the handle to reorder stops
          </p>
        )}
      </div>

      {/* No Pickups Message */}
      {totalStops === 0 && (
        <div className="p-8 text-center">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">
            No Pickups Scheduled
          </h3>
          <p className="text-sm text-gray-500">
            {isReadOnlyView
              ? 'There are no pickups scheduled for this date.'
              : 'There are no pickups scheduled for today.'}
          </p>
        </div>
      )}

      {/* Route Complete Banner - only for today */}
      {!isReadOnlyView && allComplete && totalStops > 0 && (
        <div className="bg-lime-accent px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="text-green-dark" size={20} />
            <span className="font-semibold text-green-dark">
              Route Complete!
            </span>
          </div>
          <Button size="sm" onClick={handleViewSummary}>
            View Summary
          </Button>
        </div>
      )}

      {/* Stops List with Drag and Drop */}
      {totalStops > 0 && (
        <div className="p-4 space-y-3">
          {/* Persistent Open in Google Maps button */}
          {!isReadOnlyView && startLocation && finishFarm && (
            <Button onClick={handleOpenInMaps} className="w-full" size="lg">
              <Navigation size={18} className="mr-2" />
              Open route in Google Maps
            </Button>
          )}

          <DndContext
            sensors={isReadOnlyView ? [] : sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedStops.map(s => s.client_id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedStops.map(stop => {
                const client = getClientById(stop.client_id);
                if (!client) return null;
                const isUnlocated =
                  stop.status === 'pending' &&
                  optimisation.missing.some(m => m.id === stop.client_id);
                const handleRetry = async () => {
                  if (!client.address) return;
                  const coord = await optimisation.retryGeocodeFor(client.address);
                  if (coord) {
                    addToast('success', `Found "${client.business_name}" on the map`);
                  } else {
                    addToast(
                      'error',
                      `Still couldn't place "${client.business_name}" — try editing the address in the sheet`
                    );
                  }
                };

                return (
                  <SortableStopCard
                    key={stop.client_id}
                    stop={stop}
                    client={client}
                    onClick={() => handleStopClick(stop.client_id)}
                    disabled={isReadOnlyView}
                    unlocated={isUnlocated}
                    onRetryGeocode={isUnlocated ? handleRetry : undefined}
                  />
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Destination Farm - only for today */}
          {!isReadOnlyView && destinationFarm && (
            <div className="mt-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-medium">
                Destination
              </p>
              <button
                onClick={handleDropOff}
                disabled={!allPickupsComplete}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                  allPickupsComplete
                    ? 'border-lime-accent bg-lime-50 hover:bg-lime-100'
                    : 'border-gray-200 bg-gray-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        allPickupsComplete
                          ? 'bg-lime-accent text-green-dark'
                          : 'bg-gray-300 text-gray-500'
                      }`}
                    >
                      <Truck size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">
                        {destinationFarm.farm_name}
                      </h3>
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                        <MapPin size={14} />
                        <span className="truncate">{destinationFarm.address}</span>
                      </div>
                      {!allPickupsComplete && (
                        <p className="text-xs text-gray-400 mt-2">
                          Complete all pickups first
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom padding for safe area */}
      <div className="h-24" />

      {/* Floating Add-Pickup button (today only, not in read-only) */}
      {!isReadOnlyView && selectedDate === getCurrentDate() && (
        <AddPickupButton variant="fab" />
      )}

      {/* Route options modal — only used now to override the default start/finish. */}
      <OptimiseRouteModal
        isOpen={showOptimiser}
        onClose={() => setShowOptimiser(false)}
        stops={route.stops}
        getClientById={getClientById}
        destinationFarmId={route.destination_farm_id}
        startId={startId}
        finishId={finishId}
        onChangeStart={(id) => setStartId(id)}
        onChangeFinish={(id) => {
          userPickedFinishRef.current = true;
          setFinishId(id);
          // Allow the new endpoints to re-trigger an auto-apply for this route.
          autoAppliedRef.current.delete(route.id);
          persistAutoApplied(autoAppliedRef.current);
        }}
        onApplyOrder={(ids) => {
          applyStopOrder(ids);
          addToast('success', 'Route reordered to suggested order');
        }}
      />

      <DatePickerModal
        isOpen={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        onSelectDate={(date) => setViewDate(date, false)}
        selectedDate={selectedDate}
        availableDates={availableDates}
      />
    </div>
  );
}

interface BannerProps {
  status: ReturnType<typeof useOptimalRoute>['status'];
  optimalSeconds: number;
  deltaSeconds: number;
  missingCount: number;
  error: string | null;
  onOpenSettings: () => void;
  onRestoreOptimal: () => void;
  canRestore: boolean;
}

function OptimisationBanner({
  status,
  optimalSeconds,
  deltaSeconds,
  missingCount,
  error,
  onOpenSettings,
  onRestoreOptimal,
  canRestore,
}: BannerProps) {
  if (status === 'idle') return null;

 
  const Wrap = ({ children, tone }: { children: React.ReactNode; tone: 'info' | 'success' | 'warn' }) => {
    const colors =
      tone === 'success'
        ? 'bg-lime-50 border-lime-accent text-green-dark'
        : tone === 'warn'
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-blue-50 border-blue-200 text-blue-900';
    return (
      <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${colors}`}>
        {children}
      </div>
    );
  };

  if (status === 'geocoding') {
    return (
      <Wrap tone="info">
        <Loader2 size={16} className="animate-spin shrink-0" />
        <span className="text-sm">Looking up addresses...</span>
      </Wrap>
    );
  }

  if (status === 'fetching') {
    return (
      <Wrap tone="info">
        <Loader2 size={16} className="animate-spin shrink-0" />
        <span className="text-sm">Optimising route...</span>
      </Wrap>
    );
  }

  if (status === 'unavailable') {
    return (
      <Wrap tone="warn">
        <AlertCircle size={16} className="shrink-0" />
        <span className="text-sm flex-1">
          Could not fetch driving times{error ? ` (${error.slice(0, 60)})` : ''}. Manual order only.
        </span>
        <button onClick={onOpenSettings} className="text-xs underline shrink-0">Options</button>
      </Wrap>
    );
  }

  // status === 'ready'
  // Any unplaced stops dominate the messaging: the auto-apply was refused, the
  // reported optimal-driving time only covers the located subset, and the
  // driver needs to know that stops exist outside the optimisation.
  const onOptimal = deltaSeconds <= 10;
  const tone: 'success' | 'warn' = missingCount > 0 ? 'warn' : (onOptimal ? 'success' : 'warn');
  const missingCopy =
    missingCount > 0
      ? ` ${missingCount} stop${missingCount === 1 ? '' : 's'} could not be placed - review in route options.`
      : '';

  return (
    <Wrap tone={tone}>
      <Sparkles size={16} className="shrink-0" />
      <div className="flex-1 text-sm">
        {onOptimal ? (
          <>
            Optimal route - about <span className="font-semibold">{formatDuration(optimalSeconds)}</span> driving.
            {missingCopy}
          </>
        ) : (
          <>
            Current order is <span className="font-semibold">+{formatDuration(deltaSeconds)}</span> longer than optimal.
            {missingCopy}
          </>
        )}
      </div>
      {canRestore && (
        <button onClick={onRestoreOptimal} className="text-xs font-semibold underline shrink-0">
          Restore optimal
        </button>
      )}
      <button onClick={onOpenSettings} aria-label="Route options" className="shrink-0 ml-1">
        <Settings size={14} />
      </button>
    </Wrap>
  );
}
