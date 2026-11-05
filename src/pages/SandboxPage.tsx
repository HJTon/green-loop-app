import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, RefreshCw, ChevronDown, ChevronUp, ShieldCheck, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { ConsolidationBoard } from '@/components/consolidation/ConsolidationBoard';
import { ConsolidationProgress } from '@/components/consolidation/ConsolidationProgress';
import { useApp } from '@/contexts/AppContext';
import { getClientsForDate } from '@/services/sheetDataService';
import { apiFetch } from '@/utils/apiClient';
import type { Client, ConsolidationSession, PickupRecord, BinFullness, CollectionType } from '@/types';
import {
  createPickupTilesFromPickups,
  getAssignedCount,
  allPickupsAssigned,
  buildBinTrackerRow,
  BIN_TRACKER_COLUMNS,
} from '@/services/consolidationService';

/**
 * Consolidation sandbox — a throwaway copy of the farm screen.
 *
 * The consolidation board sits at the very end of a collection day, so trying
 * it for real means marking a whole route's pickups off first (and, on the
 * live app, putting fake pickups on the invoicing sheet to have a route at
 * all). This page skips all of that: it fabricates a finished day, hands it to
 * the SAME <ConsolidationBoard /> that /consolidation and /dropoff render, and
 * ends in a preview of the Bin Tracker rows instead of a write.
 *
 * NOTHING HERE PERSISTS OR SENDS:
 *  - the session lives in React state only; `saveConsolidation` is never
 *    called, so a real day's `greenloop_consolidation` can't be clobbered;
 *  - `queueMaturingBinWrite` is never called, so no sheet row and no entry in
 *    the offline queue — Finish just renders what the row WOULD be.
 * The one optional network call is the "check placement" button, which uses
 * maturing-bins-write's own `?dryRun=1` — it reads the live tab to work out
 * the row number and writes nothing.
 *
 * Safe to open on the deployed app as well as on localhost. Reachable at
 * /sandbox and from Settings; deliberately not linked from the collection flow.
 */

const FULLNESS_CYCLE: BinFullness[] = ['full', 'full', '3-quarter', 'half', 'full', 'quarter'];

// Small deterministic PRNG so a given scenario always produces the same day —
// makes "it looked wrong on that screen" reproducible for whoever you show it to.
function makeRng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Scenario {
  key: string;
  label: string;
  hint: string;
  businesses: number;
  maxBinsEach: number;
  buckets: boolean;
  missingSerials: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    key: 'typical',
    label: 'Typical day',
    hint: '6 businesses, mostly 1-3 bins each',
    businesses: 6,
    maxBinsEach: 3,
    buckets: true,
    missingSerials: false,
  },
  {
    key: 'big',
    label: 'Big day',
    hint: '12 businesses, up to 6 bins each - the scrolling case',
    businesses: 12,
    maxBinsEach: 6,
    buckets: true,
    missingSerials: false,
  },
  {
    key: 'awkward',
    label: 'Awkward day',
    hint: 'Missing serials, a 9-bin business, buckets everywhere',
    businesses: 8,
    maxBinsEach: 9,
    buckets: true,
    missingSerials: true,
  },
  {
    key: 'sixplus',
    label: 'Six-source bin',
    hint: '7 businesses, 1 bin each - exercises the col M overflow',
    businesses: 7,
    maxBinsEach: 1,
    buckets: false,
    missingSerials: false,
  },
  {
    key: 'empty',
    label: 'Nothing collected',
    hint: 'The empty state you see if you arrive at the farm early',
    businesses: 0,
    maxBinsEach: 0,
    buckets: false,
    missingSerials: false,
  },
];

const FAKE_NAMES = [
  'Kowhai Cafe', 'The Daily Grind', 'Harbour Fish Co', 'Tui Bakehouse',
  'Mount View Motel', 'Sunrise Childcare', 'Rimu Street Deli', 'Puke Ariki Cafe',
  'Green Fork Kitchen', 'Coastal Brewing', 'Ngamotu Bistro', 'The Larder',
  'Fitzroy Grocer', 'Oakura Takeaways',
];

// A serial that looks like the real ones: 7 digits, leading zero stripped
// (the sheet stores them that way because Sheets coerces them to numbers).
function fakeSerial(rng: () => number): string {
  return String(4100000 + Math.floor(rng() * 99999));
}

function makePickup(
  clientId: string,
  date: string,
  count: number,
  collectionType: CollectionType,
  missingSerials: boolean,
  rng: () => number
): PickupRecord {
  const fullness: BinFullness[] = [];
  const serials: string[] = [];
  for (let b = 0; b < count; b++) {
    fullness.push(FULLNESS_CYCLE[Math.floor(rng() * FULLNESS_CYCLE.length)]);
    // Buckets never carry a serial in the field, and a scanned serial is
    // sometimes skipped - both leave the "suggested bin" list shorter.
    const skip = collectionType !== 'bins' || (missingSerials && rng() < 0.4);
    serials.push(skip ? '' : fakeSerial(rng));
  }

  return {
    id: `sandbox-pickup-${clientId}`,
    date,
    time: '09:00',
    client_id: clientId,
    collector_id: 'sandbox',
    bins_collected: count,
    bin_fullness: fullness,
    bin_serial_numbers: serials,
    notes: '',
    photos: [],
    report: null,
    status: 'completed',
  };
}

function buildFakeDay(scenario: Scenario, seed: number): { clients: Client[]; pickups: PickupRecord[] } {
  const rng = makeRng(seed);
  const clients: Client[] = [];
  const pickups: PickupRecord[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < scenario.businesses; i++) {
    const name = FAKE_NAMES[i % FAKE_NAMES.length];
    const id = `sandbox-${i}`;
    const collectionType: CollectionType = scenario.buckets && i % 4 === 3 ? 'buckets' : 'bins';
    const count = Math.max(1, Math.ceil(rng() * scenario.maxBinsEach));

    clients.push({
      id,
      business_name: name,
      contact_name: '',
      contact_phone: '',
      contact_email: '',
      address: '',
      delivery_notes: '',
      collection_type: collectionType,
      expected_quantity: count,
      collection_frequency: 'Weekly',
      price_per_unit: 0,
      paper_towel_pickup: false,
      special_instructions: '',
      logo_url: null,
      active: true,
    });

    pickups.push(makePickup(id, today, count, collectionType, scenario.missingSerials, rng));
  }

  return { clients, pickups };
}

// A real day off the schedule sheet: real business names, real bin types and
// expected quantities, with fullness and serials made up (neither is recorded
// on the schedule). Read-only - `getClientsForDate` just reads the cache the
// app already loaded at boot.
function buildRealDay(clients: Client[], seed: number): PickupRecord[] {
  const rng = makeRng(seed);
  const today = new Date().toISOString().split('T')[0];
  return clients.map(client =>
    makePickup(
      client.id,
      today,
      Math.max(1, client.expected_quantity || 1),
      client.collection_type,
      false,
      rng
    )
  );
}

function newSession(clients: Client[], pickups: PickupRecord[]): ConsolidationSession {
  return {
    id: 'sandbox-session',
    date: new Date().toISOString().split('T')[0],
    collectorId: 'sandbox',
    pickupTiles: createPickupTilesFromPickups(pickups, clients),
    maturingBins: [],
    completedAt: null,
    activeBinId: null,
  };
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SandboxPage() {
  const navigate = useNavigate();
  const { addToast, availableDates } = useApp();

  const [source, setSource] = useState<'fake' | 'real'>('fake');
  const [scenarioKey, setScenarioKey] = useState('typical');
  const [seed, setSeed] = useState(1);
  const [realDate, setRealDate] = useState<string>('');
  const [realClients, setRealClients] = useState<Client[] | null>(null);
  const [loadingReal, setLoadingReal] = useState(false);

  const [session, setSession] = useState<ConsolidationSession | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [checkingPlacement, setCheckingPlacement] = useState(false);

  const scenario = SCENARIOS.find(s => s.key === scenarioKey) || SCENARIOS[0];

  const fakeDay = useMemo(() => buildFakeDay(scenario, seed), [scenario, seed]);

  const clients = source === 'real' ? realClients || [] : fakeDay.clients;
  const pickups = useMemo(
    () => (source === 'real' ? buildRealDay(realClients || [], seed) : fakeDay.pickups),
    [source, realClients, seed, fakeDay]
  );

  const reseed = useCallback(() => {
    setSession(newSession(clients, pickups));
    setShowPreview(false);
    setPlacement({});
  }, [clients, pickups]);

  // Re-seed whenever the chosen day changes. Any bins already built are thrown
  // away with it - that's what the reset button does too.
  useEffect(() => {
    reseed();
  }, [reseed]);

  const loadRealDate = async (dateKey: string) => {
    setRealDate(dateKey);
    if (!dateKey) return;
    setLoadingReal(true);
    try {
      const loaded = await getClientsForDate(new Date(`${dateKey}T00:00:00`));
      setRealClients(loaded);
      if (loaded.length === 0) addToast('info', 'No stops scheduled on that date');
    } catch (error) {
      console.error('Sandbox: failed to load real day', error);
      addToast('error', 'Could not read that day from the schedule');
    } finally {
      setLoadingReal(false);
    }
  };

  const checkPlacement = async () => {
    if (!session) return;
    setCheckingPlacement(true);
    try {
      const results: Record<string, string> = {};
      for (const bin of session.maturingBins) {
        const response = await apiFetch('/.netlify/functions/maturing-bins-write?dryRun=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bin, collectorName: 'Sandbox', farmName: 'Sandbox' }),
        });
        if (!response.ok) {
          results[bin.id] = `dry run failed (${response.status})`;
          continue;
        }
        const data = await response.json();
        results[bin.id] = `would land on sheet row ${data.wouldInsertAtRow}`;
      }
      setPlacement(results);
    } catch (error) {
      console.error('Sandbox: dry run failed', error);
      addToast('error', 'Dry run could not reach the sheet');
    } finally {
      setCheckingPlacement(false);
    }
  };

  if (!session) return null;

  const assignedCount = getAssignedCount(session);
  const hasPickups = session.pickupTiles.length > 0;
  const canFinish = hasPickups && allPickupsAssigned(session) && session.maturingBins.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Consolidation Sandbox" showBack />

      {/* Standing reminder - this screen is pixel-identical to the real one, so
          it needs to be obvious which one you're looking at. */}
      <div className="bg-purple-100 border-b-2 border-purple-300 px-4 py-2 flex items-start gap-2">
        <ShieldCheck size={16} className="text-purple-700 mt-0.5 shrink-0" />
        <p className="text-xs text-purple-900">
          <span className="font-semibold">Sandbox &mdash; nothing is saved or sent.</span>{' '}
          Fake day, in memory only. No sheet rows, no pickup records, no effect on today&apos;s
          real consolidation.
        </p>
      </div>

      {/* Setup */}
      <div className="bg-white border-b border-gray-200">
        <button
          type="button"
          onClick={() => setShowSetup(v => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FlaskConical size={16} className="text-purple-600" />
            Test data
            <span className="font-normal text-gray-500">
              &mdash; {source === 'real' ? realDate || 'pick a date' : scenario.label},{' '}
              {session.pickupTiles.length} bin{session.pickupTiles.length === 1 ? '' : 's'}
            </span>
          </span>
          {showSetup ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showSetup && (
          <div className="px-4 pb-3 space-y-3">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setSource('fake')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 ${
                  source === 'fake'
                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                Made-up day
              </button>
              <button
                type="button"
                onClick={() => setSource('real')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 ${
                  source === 'real'
                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                A real day&apos;s stops
              </button>
            </div>

            {source === 'fake' ? (
              <div className="space-y-1.5">
                {SCENARIOS.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setScenarioKey(s.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg border-2 ${
                      s.key === scenarioKey
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-gray-900">{s.label}</span>
                    <span className="block text-xs text-gray-500">{s.hint}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Collection date from the schedule sheet (read-only)
                </label>
                <select
                  value={realDate}
                  onChange={e => loadRealDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="">Choose a date...</option>
                  {availableDates.map(date => {
                    const key = formatDateKey(date);
                    return (
                      <option key={key} value={key}>
                        {date.toLocaleDateString('en-NZ', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Real business names, bin types and expected quantities. Fullness and serial
                  numbers are invented &mdash; the schedule doesn&apos;t record them.
                  {loadingReal && ' Loading...'}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" fullWidth onClick={reseed}>
                <RefreshCw size={15} className="mr-1.5" />
                Reset board
              </Button>
              {source === 'fake' && (
                <Button variant="outline" fullWidth onClick={() => setSeed(s => s + 1)}>
                  Shuffle
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <ConsolidationProgress assigned={assignedCount} total={session.pickupTiles.length} />

      <div className="p-3">
        {/* The real component, unmodified - what you see here is what the farm
            screen does. */}
        <ConsolidationBoard
          session={session}
          setSession={setSession}
          collectorId="sandbox"
          farmId="sandbox"
          addToast={addToast}
        />

        <div className="mt-4">
          <Button fullWidth size="lg" onClick={() => setShowPreview(true)} disabled={!canFinish}>
            Finish (show me what would be written)
          </Button>
          {!canFinish && (
            <p className="text-sm text-gray-500 text-center mt-2">
              {!hasPickups
                ? 'Nothing to consolidate in this scenario'
                : 'Put everything in a bin to finish, same as the real screen'}
            </p>
          )}
        </div>

        {/* Row preview */}
        {showPreview && (
          <div className="mt-4 space-y-3">
            <div className="bg-white rounded-xl border-2 border-purple-200 p-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Bin Tracker rows this would have written
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {session.maturingBins.length} row{session.maturingBins.length === 1 ? '' : 's'}
                {' '}&mdash; shown instead of sent. The real screen posts these to the
                maturing-bins sheet.
              </p>
            </div>

            {session.maturingBins.map(bin => {
              const row = buildBinTrackerRow(bin);
              return (
                <div key={bin.id} className="bg-white rounded-xl border border-gray-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-gray-900">#{bin.serialNumber}</p>
                    <p className="text-xs text-gray-500">
                      {placement[bin.id] || `${bin.contents.length} in`}
                    </p>
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="text-xs w-full">
                      <tbody>
                        {BIN_TRACKER_COLUMNS.map((label, i) => (
                          <tr key={label} className="border-b border-gray-100 last:border-0">
                            <td className="py-1 pr-3 text-gray-500 whitespace-nowrap align-top">
                              {label}
                            </td>
                            <td className="py-1 text-gray-900 break-all font-mono">
                              {row[i] || <span className="text-gray-300">(blank)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <Button variant="outline" fullWidth onClick={checkPlacement} disabled={checkingPlacement}>
              {checkingPlacement ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                'Check where these rows would land (read-only)'
              )}
            </Button>
            <p className="text-[11px] text-gray-500 text-center">
              Uses maturing-bins-write&apos;s own dry-run mode: it reads the live tab to work out
              the row number and writes nothing.
            </p>

            <Button variant="outline" fullWidth onClick={() => navigate('/settings')}>
              Done
            </Button>
          </div>
        )}
      </div>

      <div className="h-8" />
    </div>
  );
}
