import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Package, ShoppingBag, Sprout, AlertCircle, ArrowRight, MapPin, Gift, Split } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { AddPickupButton } from '@/components/AddPickupButton';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useApp } from '@/contexts/AppContext';
import { getWelcomeKitItems } from '@/utils/storage';
import { binLoad, BIN_CAPACITY } from '@/utils/vanLoad';
import type { Client } from '@/types';

export function LoadVanPage() {
  const navigate = useNavigate();
  const {
    collector,
    route,
    isLoading,
    loadError,
    getClientById,
    splitState,
  } = useApp();

  // Redirect if not authenticated
  useEffect(() => {
    if (!collector && !isLoading) {
      navigate('/');
    }
  }, [collector, isLoading, navigate]);

  // Calculate totals and per-stop breakdown
  const summary = useMemo(() => {
    if (!route) {
      return { totalBins: 0, totalBuckets: 0, totalSoil: 0, stopsByType: [], totalStops: 0 };
    }

    let totalBins = 0;
    let totalBuckets = 0;
    let totalSoil = 0;
    const lines: { name: string; quantity: number; type: 'bins' | 'buckets' | 'soil' }[] = [];

    for (const stop of route.stops) {
      const client = getClientById(stop.client_id);
      if (!client) continue;

      const qty = client.expected_quantity || 1;
      if (client.collection_type === 'bins') {
        totalBins += binLoad(client);
      } else if (client.collection_type === 'soil') {
        totalSoil += qty;
      } else {
        totalBuckets += qty;
      }
      lines.push({
        name: client.business_name,
        quantity: qty,
        type: client.collection_type,
      });
    }

    return {
      totalBins,
      totalBuckets,
      totalSoil,
      stopsByType: lines,
      totalStops: route.stops.length,
    };
  }, [route, getClientById]);

  // Businesses on today's route having their first-ever collection — they each
  // need a welcome kit packed into the van before heading out.
  const firstVisitClients = useMemo(() => {
    if (!route) return [] as Client[];
    return route.stops
      .map(stop => getClientById(stop.client_id))
      .filter((c): c is Client => !!c && c.is_first_visit === true);
  }, [route, getClientById]);

  const welcomeKitItems = getWelcomeKitItems();

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
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    );
  }

  if (!collector) return null;

  const { totalBins, totalBuckets, totalSoil, stopsByType, totalStops } = summary;
  const hasAnything = totalBins > 0 || totalBuckets > 0 || totalSoil > 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-36">
      <Header title="Load the van" showLogout showSettings />

      <div className="px-4 py-4 space-y-4">
        {/* Intro */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-green-primary text-white flex items-center justify-center shrink-0">
              <Truck size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Before you head out</h2>
              <p className="text-sm text-gray-600 mt-0.5">
                Load these empty bins and buckets into the van so you can swap them out at each stop.
              </p>
            </div>
          </div>
        </div>

        {/* Big day — offer to split into two runs */}
        {totalBins > BIN_CAPACITY && !splitState?.enabled && (
          <button
            onClick={() => navigate('/split')}
            className="w-full text-left bg-green-primary/10 border-2 border-green-primary rounded-xl p-4 hover:bg-green-primary/15 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-green-primary text-white flex items-center justify-center shrink-0">
                <Split size={20} />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-green-dark">Big day — split into two runs?</h2>
                <p className="text-sm text-gray-700 mt-0.5">
                  {totalBins} bins won't fit in one van ({BIN_CAPACITY} max). Plan a full run and a
                  lighter one.
                </p>
              </div>
              <ArrowRight size={20} className="text-green-primary shrink-0 mt-2" />
            </div>
          </button>
        )}

        {splitState?.enabled && (
          <button
            onClick={() => navigate('/split')}
            className="w-full text-left bg-lime-50 border-2 border-lime-accent rounded-xl p-4 hover:bg-lime-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Split size={20} className="text-green-dark shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-green-dark">
                  Day is split into two runs — doing Run {splitState.activeRun} now
                </p>
                <p className="text-sm text-gray-600">Tap to review or rebalance the split</p>
              </div>
            </div>
          </button>
        )}

        {/* First-visit welcome kits */}
        {firstVisitClients.length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                <Gift size={20} />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-amber-900">
                  Pack {firstVisitClients.length === 1 ? 'a welcome kit' : `${firstVisitClients.length} welcome kits`}
                </h2>
                <p className="text-sm text-amber-800 mt-0.5">
                  {firstVisitClients.length === 1 ? 'A business has' : `${firstVisitClients.length} businesses have`}{' '}
                  their first collection today. Don't head out without{' '}
                  {firstVisitClients.length === 1 ? 'a kit' : 'one kit each'}:
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {welcomeKitItems.map((item, i) => (
                    <li
                      key={i}
                      className="text-xs font-medium bg-white border border-amber-300 text-amber-900 rounded-full px-2.5 py-1"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-700 mt-2">
                  For: {firstVisitClients.map(c => c.business_name).join(', ')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* The big numbers */}
        {hasAnything ? (
          <div className={`grid gap-3 ${totalSoil > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {/* Bins */}
            <div className="bg-white rounded-xl border-2 border-green-primary p-4 text-center">
              <Package className="w-8 h-8 text-green-primary mx-auto mb-1" />
              <div className="text-4xl font-bold text-gray-900">{totalBins}</div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mt-1">
                Empty {totalBins === 1 ? 'bin' : 'bins'}
              </div>
            </div>

            {/* Buckets */}
            <div className="bg-white rounded-xl border-2 border-lime-accent p-4 text-center">
              <ShoppingBag className="w-8 h-8 text-green-dark mx-auto mb-1" />
              <div className="text-4xl font-bold text-gray-900">{totalBuckets}</div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mt-1">
                Empty {totalBuckets === 1 ? 'bucket' : 'buckets'}
              </div>
            </div>

            {/* Soil / green-waste bins */}
            {totalSoil > 0 && (
              <div className="bg-white rounded-xl border-2 border-amber-500 p-4 text-center">
                <Sprout className="w-8 h-8 text-amber-600 mx-auto mb-1" />
                <div className="text-4xl font-bold text-gray-900">{totalSoil}</div>
                <div className="text-xs uppercase tracking-wide text-gray-500 mt-1">
                  Soil {totalSoil === 1 ? 'bin' : 'bins'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 text-center border border-gray-200">
            <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-600">No pickups scheduled for today.</p>
          </div>
        )}

        {/* Soil bins note */}
        {totalSoil > 0 && (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            <Sprout className="shrink-0 mt-0.5" size={14} />
            <span>
              Soil / green-waste bins need a bin loaded but no mulch or biochar prep. Just drop
              them at the community garden and tap <span className="font-semibold">Done</span> — no scan or count needed.
            </span>
          </div>
        )}

        {/* Breakdown per stop */}
        {hasAnything && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Breakdown
              </span>
              <span className="text-xs text-gray-500">{totalStops} {totalStops === 1 ? 'stop' : 'stops'}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {stopsByType.map((line, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-800 truncate pr-3">{line.name}</span>
                  <span className="text-sm font-medium text-gray-700 shrink-0 flex items-center gap-1">
                    {line.type === 'bins' ? (
                      <Package size={14} className="text-green-primary" />
                    ) : line.type === 'soil' ? (
                      <Sprout size={14} className="text-amber-600" />
                    ) : (
                      <ShoppingBag size={14} className="text-green-dark" />
                    )}
                    {line.quantity}x {line.type}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center italic px-4">
          Numbers are based on each customer's expected quantity in the schedule. Actual pickup counts may vary.
        </p>
      </div>

      {/* Sticky bottom actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg space-y-2">
        <AddPickupButton variant="inline" className="w-full" />
        <Button onClick={() => navigate('/route')} className="w-full">
          {hasAnything ? "Van loaded — let's go" : 'Continue to route'}
          <ArrowRight size={18} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}
