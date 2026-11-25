// Which farm each customer's food waste goes to, and how a day's stops group
// into per-farm runs.
//
// Rules (agreed 2026-11-23):
// - Each customer has a preferred farm (Site Info col E, else the bundled
//   default list from Caroline's split).
// - A farm flagged `assigned_only` (Eudaimonia — feedstock trials) only takes
//   customers assigned to it. Everyone else, including customers with no
//   preference, goes to an open farm.
// - When a day has stops for two farms, the van does one run per farm, one
//   after the other: the closed farm's run first (depot → its stops → that
//   farm), then the open farm's run starting from the first farm.

import type { Client, Farm, RouteStop } from '@/types';
import { farms } from '@/utils/data';
import { getActiveFarmsWithCoords } from '@/utils/routeOptimiser';
import assignmentsData from '@/data/farm-assignments.json';

const norm = (s: string) => s.trim().toLowerCase();

const defaultAssignments = new Map<string, string>(
  Object.entries((assignmentsData as { assignments: Record<string, string> }).assignments).map(
    ([business, farmName]) => [norm(business), farmName]
  )
);

/** Farm id for a farm name (case-insensitive), or undefined if unknown. */
export function farmIdForName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const n = norm(name);
  if (!n) return undefined;
  return farms.find(f => norm(f.farm_name) === n || f.id === name.trim())?.id;
}

/**
 * Resolve a business's preferred farm id. `sheetValue` is the Site Info col E
 * entry (a farm name) and wins when it names a known farm; otherwise fall back
 * to the bundled default list.
 */
export function resolvePreferredFarmId(businessName: string, sheetValue?: string): string | undefined {
  return farmIdForName(sheetValue) ?? farmIdForName(defaultAssignments.get(norm(businessName)));
}

/** Active farms the van can actually drive to (have coordinates). */
function routableFarms(): Farm[] {
  return getActiveFarmsWithCoords();
}

/** The farm a customer goes to today, before any day override. */
export function farmForClient(client: Client | undefined): string | undefined {
  const available = routableFarms();
  if (available.length === 0) return undefined;
  const preferred = client?.preferred_farm_id;
  if (preferred && available.some(f => f.id === preferred)) return preferred;
  // No usable preference → first open farm (not assigned_only), else any.
  return (available.find(f => !f.assigned_only) ?? available[0]).id;
}

export function isLockedFarm(farmId: string | undefined): boolean {
  return !!farmId && !!farms.find(f => f.id === farmId)?.assigned_only;
}

export interface FarmGrouping {
  /** Farm ids present today, closed (assigned_only) farm first. */
  farmIds: string[];
  /** client_id → farm id for every stop. */
  byClient: Map<string, string>;
}

/** Group a day's stops by the farm each customer goes to. */
export function groupStopsByFarm(
  stops: RouteStop[],
  getClientById: (id: string) => Client | undefined
): FarmGrouping {
  const byClient = new Map<string, string>();
  const present = new Set<string>();
  for (const s of stops) {
    const farmId = farmForClient(getClientById(s.client_id));
    if (!farmId) continue;
    byClient.set(s.client_id, farmId);
    present.add(farmId);
  }
  const farmIds = [...present].sort((a, b) => {
    const la = isLockedFarm(a) ? 0 : 1;
    const lb = isLockedFarm(b) ? 0 : 1;
    return la - lb || a.localeCompare(b);
  });
  return { farmIds, byClient };
}

/** Start id meaning "set off from this farm" (run 2 begins where run 1 ended). */
export function farmStartId(farmId: string): string {
  return `farm:${farmId}`;
}

export function parseFarmStartId(startId: string): string | null {
  return startId.startsWith('farm:') ? startId.slice(5) : null;
}

export interface FarmSplitPlan {
  run1Ids: string[];
  run2Ids: string[];
  run1: { startId: string; finishId: string };
  run2: { startId: string; finishId: string };
}

/**
 * The per-farm split for a day, or null when every stop goes to one farm.
 * Run 1 = the closed farm's customers (depot → stops → that farm); run 2 = the
 * rest, setting off from run 1's farm and finishing at their own.
 */
export function planFarmSplit(
  stops: RouteStop[],
  getClientById: (id: string) => Client | undefined,
  depotStartId: string
): FarmSplitPlan | null {
  const { farmIds, byClient } = groupStopsByFarm(stops, getClientById);
  if (farmIds.length < 2) return null;
  const [farm1, farm2] = farmIds;
  const run1Ids: string[] = [];
  const run2Ids: string[] = [];
  for (const s of stops) {
    (byClient.get(s.client_id) === farm1 ? run1Ids : run2Ids).push(s.client_id);
  }
  return {
    run1Ids,
    run2Ids,
    run1: { startId: depotStartId, finishId: farm1 },
    run2: { startId: farmStartId(farm1), finishId: farm2 },
  };
}
