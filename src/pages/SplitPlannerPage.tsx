import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Package, ShoppingBag, Sprout, AlertCircle, ArrowRight, ArrowLeft,
  Loader2, Sparkles, CheckCircle2, Flag,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useApp } from '@/contexts/AppContext';
import { useRouteSplit } from '@/hooks/useRouteSplit';
import { BIN_CAPACITY } from '@/utils/vanLoad';
import {
  getActiveStartLocationsWithCoords,
  getActiveFarmsWithCoords,
} from '@/utils/routeOptimiser';
import type { Client, RunEndpoints } from '@/types';

function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

type RunNo = 1 | 2;

export function SplitPlannerPage() {
  const navigate = useNavigate();
  const {
    collector,
    route,
    isLoading,
    getClientById,
    splitState,
    applySplit,
    clearSplit,
    addToast,
  } = useApp();

  const startOptions = useMemo(() => getActiveStartLocationsWithCoords(), []);
  const farmOptions = useMemo(() => getActiveFarmsWithCoords(), []);

  const split = useRouteSplit({
    stops: route?.stops ?? [],
    getClientById,
    enabled: !!route,
  });

  // Per-run endpoints. Seed from an existing split, else depot[0] → route farm.
  const defaultFinish =
    route?.destination_farm_id && farmOptions.some(f => f.id === route.destination_farm_id)
      ? route.destination_farm_id
      : farmOptions[0]?.id ?? '';
  const defaultStart = startOptions[0]?.id ?? '';

  const [run1Endpoints, setRun1Endpoints] = useState<RunEndpoints>(
    splitState?.run1 ?? { startId: defaultStart, finishId: defaultFinish }
  );
  const [run2Endpoints, setRun2Endpoints] = useState<RunEndpoints>(
    splitState?.run2 ?? { startId: defaultStart, finishId: defaultFinish }
  );
  const [firstRun, setFirstRun] = useState<RunNo>(splitState?.firstRun ?? 1);

  // Membership: which run each located stop belongs to. Within-run *order* is
  // always the optimiser's — moving a stop only changes membership.
  const [assignment, setAssignment] = useState<Record<string, RunNo>>({});
  const seededRef = useRef(false);

  // Seed the assignment once the matrix is ready: from existing run tags when
  // re-editing a split, otherwise from the balanced auto-suggestion.
  useEffect(() => {
    if (seededRef.current) return;
    if (split.status !== 'ready') return;

    if (splitState?.enabled && route) {
      const next: Record<string, RunNo> = {};
      for (const l of split.located) {
        const stop = route.stops.find(s => s.client_id === l.id);
        next[l.id] = (stop?.run ?? 1) as RunNo;
      }
      setAssignment(next);
      seededRef.current = true;
      return;
    }

    const suggestion = split.suggest({ run1: run1Endpoints, run2: run2Endpoints });
    if (!suggestion) return;
    const next: Record<string, RunNo> = {};
    suggestion.run1.ids.forEach(id => (next[id] = 1));
    suggestion.run2.ids.forEach(id => (next[id] = 2));
    // Any located stop the suggestion didn't place (shouldn't happen) → run 1.
    for (const l of split.located) if (next[l.id] == null) next[l.id] = 1;
    setAssignment(next);
    seededRef.current = true;
    if (!suggestion.feasible) {
      addToast('error', "Couldn't fit a full van under the limit — adjust the split by hand");
    }
  }, [split, splitState, route, run1Endpoints, run2Endpoints, addToast]);

  const run1Ids = useMemo(
    () => split.located.filter(l => assignment[l.id] === 1).map(l => l.id),
    [split.located, assignment]
  );
  const run2Ids = useMemo(
    () => split.located.filter(l => assignment[l.id] === 2).map(l => l.id),
    [split.located, assignment]
  );

  const run1Plan = useMemo(
    () => split.planRun(run1Ids, run1Endpoints),
    [split, run1Ids, run1Endpoints]
  );
  const run2Plan = useMemo(
    () => split.planRun(run2Ids, run2Endpoints),
    [split, run2Ids, run2Endpoints]
  );

  // Redirect out if there's nothing to split.
  useEffect(() => {
    if (!collector && !isLoading) navigate('/');
  }, [collector, isLoading, navigate]);

  if (isLoading) return <LoadingSpinner message="Loading route..." fullScreen />;
  if (!collector || !route) return null;

  const moveStop = (id: string, to: RunNo) => {
    setAssignment(prev => ({ ...prev, [id]: to }));
  };

  const reSuggest = () => {
    const suggestion = split.suggest({ run1: run1Endpoints, run2: run2Endpoints });
    if (!suggestion) {
      addToast('error', 'Driving times not ready yet — try again in a moment');
      return;
    }
    const next: Record<string, RunNo> = {};
    suggestion.run1.ids.forEach(id => (next[id] = 1));
    suggestion.run2.ids.forEach(id => (next[id] = 2));
    for (const l of split.located) if (next[l.id] == null) next[l.id] = 1;
    setAssignment(next);
    addToast('success', 'Suggested a balanced split');
  };

  const handleConfirm = () => {
    if (run1Ids.length === 0 || run2Ids.length === 0) {
      addToast('error', 'Each run needs at least one stop');
      return;
    }
    // Persist using the optimised order for each run.
    const orderedRun1 = run1Plan?.ids ?? run1Ids;
    const orderedRun2 = run2Plan?.ids ?? run2Ids;
    applySplit({
      run1Ids: orderedRun1,
      run2Ids: orderedRun2,
      run1Endpoints,
      run2Endpoints,
      firstRun,
    });
    addToast('success', 'Split into two runs');
    navigate('/route');
  };

  const isFetching = split.isFetching || split.status === 'fetching' || split.status === 'geocoding';

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <Header title="Split into two runs" showLogout showSettings />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-green-primary text-white flex items-center justify-center shrink-0">
              <Truck size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Too big for one van</h2>
              <p className="text-sm text-gray-600 mt-0.5">
                {split.totalBins} bins today — a van holds {BIN_CAPACITY}. We've suggested a full
                run and a lighter one. Move stops between runs if you'd like, then pick which to do
                first.
              </p>
            </div>
          </div>
        </div>

        {isFetching && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2 items-center">
            <Loader2 size={18} className="text-blue-600 shrink-0 animate-spin" />
            <p className="text-sm text-blue-900">Working out the best two routes…</p>
          </div>
        )}

        {split.status === 'unavailable' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
            <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">
              Couldn't fetch driving times{split.error ? ` (${split.error.slice(0, 60)})` : ''}.
              You can still split by hand, but times won't show.
            </p>
          </div>
        )}

        {split.missing.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
            <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                {split.missing.length} stop{split.missing.length === 1 ? '' : 's'} couldn't be placed
                on the map — {split.missing.length === 1 ? 'it' : 'they'}'ll go in Run 1:
              </p>
              <p className="text-xs mt-1">{split.missing.map(c => c.business_name).join(', ')}</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <RunColumn
            runNo={1}
            isFirst={firstRun === 1}
            ids={run1Plan?.ids ?? run1Ids}
            bins={run1Plan?.bins ?? 0}
            seconds={run1Plan?.seconds ?? null}
            endpoints={run1Endpoints}
            onChangeEndpoints={setRun1Endpoints}
            startOptions={startOptions}
            farmOptions={farmOptions}
            getClientById={getClientById}
            onMove={id => moveStop(id, 2)}
          />
          <RunColumn
            runNo={2}
            isFirst={firstRun === 2}
            ids={run2Plan?.ids ?? run2Ids}
            bins={run2Plan?.bins ?? 0}
            seconds={run2Plan?.seconds ?? null}
            endpoints={run2Endpoints}
            onChangeEndpoints={setRun2Endpoints}
            startOptions={startOptions}
            farmOptions={farmOptions}
            getClientById={getClientById}
            onMove={id => moveStop(id, 1)}
          />
        </div>

        <Button variant="outline" onClick={reSuggest} className="w-full">
          <Sparkles size={18} className="mr-2" />
          Suggest a balanced split
        </Button>

        {/* Which run first */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Which run first?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([1, 2] as RunNo[]).map(r => (
              <button
                key={r}
                onClick={() => setFirstRun(r)}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  firstRun === r
                    ? 'border-green-primary bg-lime-50 text-green-dark'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                <Flag size={16} />
                Run {r} first
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg space-y-2">
        <Button onClick={handleConfirm} className="w-full" size="lg">
          <CheckCircle2 size={18} className="mr-2" />
          Confirm — start Run {firstRun}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/route')} className="flex-1">
            <ArrowLeft size={16} className="mr-1" />
            Cancel
          </Button>
          {splitState?.enabled && (
            <Button
              variant="outline"
              onClick={() => {
                clearSplit();
                addToast('success', 'Back to one run');
                navigate('/route');
              }}
              className="flex-1"
            >
              Combine to one run
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface RunColumnProps {
  runNo: RunNo;
  isFirst: boolean;
  ids: string[];
  bins: number;
  seconds: number | null;
  endpoints: RunEndpoints;
  onChangeEndpoints: (e: RunEndpoints) => void;
  startOptions: { id: string; name: string; address: string }[];
  farmOptions: { id: string; farm_name: string; address: string }[];
  getClientById: (id: string) => Client | undefined;
  onMove: (id: string) => void;
}

function RunColumn({
  runNo,
  isFirst,
  ids,
  bins,
  seconds,
  endpoints,
  onChangeEndpoints,
  startOptions,
  farmOptions,
  getClientById,
  onMove,
}: RunColumnProps) {
  const overCapacity = bins > BIN_CAPACITY;
  const full = bins === BIN_CAPACITY;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">Run {runNo}</span>
            {isFirst && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-primary text-white rounded-full px-2 py-0.5">
                First
              </span>
            )}
          </div>
          <div className="text-right">
            <div
              className={`text-sm font-semibold ${
                overCapacity ? 'text-red-600' : full ? 'text-green-dark' : 'text-gray-700'
              }`}
            >
              <Package size={13} className="inline mb-0.5 mr-1" />
              {bins}/{BIN_CAPACITY} bins
            </div>
            {seconds != null && (
              <div className="text-xs text-gray-500">~{formatDuration(seconds)} driving</div>
            )}
          </div>
        </div>
        {overCapacity && (
          <p className="text-xs text-red-600 mt-1">Over the van limit — move a bin stop across.</p>
        )}
      </div>

      {/* Endpoints */}
      <div className="px-4 py-3 grid grid-cols-1 gap-2 border-b border-gray-100">
        <label className="block">
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Start</span>
          <select
            value={endpoints.startId}
            onChange={e => onChangeEndpoints({ ...endpoints, startId: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-green-primary focus:ring-1 focus:ring-green-primary"
          >
            {startOptions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Finish</span>
          <select
            value={endpoints.finishId}
            onChange={e => onChangeEndpoints({ ...endpoints, finishId: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-green-primary focus:ring-1 focus:ring-green-primary"
          >
            {farmOptions.map(f => (
              <option key={f.id} value={f.id}>{f.farm_name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Stops */}
      <ul className="divide-y divide-gray-100 flex-1">
        {ids.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-gray-400">No stops in this run</li>
        )}
        {ids.map((id, i) => {
          const client = getClientById(id);
          if (!client) return null;
          const TypeIcon =
            client.collection_type === 'bins'
              ? Package
              : client.collection_type === 'soil'
                ? Sprout
                : ShoppingBag;
          return (
            <li key={id} className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-5 h-5 rounded-full bg-green-primary text-white text-xs font-semibold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{client.business_name}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <TypeIcon size={11} />
                  {client.expected_quantity || 1}x {client.collection_type}
                </p>
              </div>
              <button
                onClick={() => onMove(id)}
                className="shrink-0 flex items-center gap-1 text-xs font-medium text-green-primary hover:text-green-dark rounded-md border border-green-primary/40 px-2 py-1"
                title={`Move to Run ${runNo === 1 ? 2 : 1}`}
              >
                {runNo === 1 ? (
                  <>Run 2 <ArrowRight size={13} /></>
                ) : (
                  <><ArrowLeft size={13} /> Run 1</>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
