import type { PickupRecord, Route, RouteStop, DropOffRecord, ConsolidationSession, MaturingBin } from '@/types';
import type { PendingWrite } from '@/types/sheet';

const PICKUPS_KEY = 'greenloop_pickups';
const ROUTE_STATE_KEY = 'greenloop_route_state';
const SESSION_KEY = 'greenloop_session';
const DROPOFF_KEY = 'greenloop_dropoff';
const PENDING_WRITES_KEY = 'greenloop_pending_writes';
const CONSOLIDATION_KEY = 'greenloop_consolidation';
const MATURING_BINS_KEY = 'greenloop_maturing_bins';

// Session management
export function saveSession(collectorId: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    collectorId,
    timestamp: new Date().toISOString(),
  }));
}

export function getSession(): { collectorId: string; timestamp: string } | null {
  const data = localStorage.getItem(SESSION_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

// Pickup records
export function savePickup(pickup: PickupRecord): void {
  const pickups = getPickups();
  const existingIndex = pickups.findIndex(p => p.id === pickup.id);
  if (existingIndex >= 0) {
    pickups[existingIndex] = pickup;
  } else {
    pickups.push(pickup);
  }
  localStorage.setItem(PICKUPS_KEY, JSON.stringify(pickups));
}

export function getPickups(): PickupRecord[] {
  const data = localStorage.getItem(PICKUPS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function getTodayPickups(): PickupRecord[] {
  const today = new Date().toISOString().split('T')[0];
  return getPickups().filter(p => p.date === today);
}

export function getPickupById(id: string): PickupRecord | null {
  const pickups = getPickups();
  return pickups.find(p => p.id === id) || null;
}

export function getPickupByClientAndDate(clientId: string, date: string): PickupRecord | null {
  const pickups = getPickups();
  return pickups.find(p => p.client_id === clientId && p.date === date) || null;
}

// Route state (track completed/skipped stops)
export function saveRouteState(routeId: string, stops: RouteStop[]): void {
  const routeStates = getRouteStates();
  routeStates[routeId] = stops;
  localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(routeStates));
}

export function getRouteStates(): Record<string, RouteStop[]> {
  const data = localStorage.getItem(ROUTE_STATE_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function getRouteState(routeId: string): RouteStop[] | null {
  const states = getRouteStates();
  return states[routeId] || null;
}

// Merge route from JSON with saved state
export function mergeRouteWithState(route: Route): Route {
  const savedStops = getRouteState(route.id);
  if (!savedStops) return route;

  return {
    ...route,
    stops: route.stops.map(stop => {
      const savedStop = savedStops.find(s => s.client_id === stop.client_id);
      return savedStop || stop;
    }),
  };
}

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Get current time formatted
export function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-NZ', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Get current date formatted
export function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Get formatted date for display (NZ format)
export function getDisplayDate(): string {
  return new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  });
}

// Clear all data for new day
export function clearAllData(): void {
  localStorage.removeItem(PICKUPS_KEY);
  localStorage.removeItem(ROUTE_STATE_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(DROPOFF_KEY);
  localStorage.removeItem(CONSOLIDATION_KEY);
}

// Drop-off records
export function saveDropOff(dropOff: DropOffRecord): void {
  localStorage.setItem(DROPOFF_KEY, JSON.stringify(dropOff));
}

export function getDropOff(): DropOffRecord | null {
  const data = localStorage.getItem(DROPOFF_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getTodayDropOff(): DropOffRecord | null {
  const dropOff = getDropOff();
  if (!dropOff) return null;
  const today = new Date().toISOString().split('T')[0];
  return dropOff.date === today ? dropOff : null;
}

// Pending writes (for Google Sheets write-back)
export function savePendingWrite(write: PendingWrite): void {
  const writes = getPendingWrites();
  // Check if write for same row/column already exists and update it
  const existingIndex = writes.findIndex(
    w => w.rowIndex === write.rowIndex && w.dateColumnIndex === write.dateColumnIndex
  );
  if (existingIndex >= 0) {
    writes[existingIndex] = write;
  } else {
    writes.push(write);
  }
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes));
}

export function getPendingWrites(): PendingWrite[] {
  const data = localStorage.getItem(PENDING_WRITES_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function clearPendingWrite(id: string): void {
  const writes = getPendingWrites().filter(w => w.id !== id);
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes));
}

export function markWriteSynced(rowIndex: number, dateColumnIndex: number): void {
  const writes = getPendingWrites().filter(
    w => !(w.rowIndex === rowIndex && w.dateColumnIndex === dateColumnIndex)
  );
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes));
}

export function clearAllPendingWrites(): void {
  localStorage.removeItem(PENDING_WRITES_KEY);
}

// Consolidation session management
export function saveConsolidation(session: ConsolidationSession): void {
  localStorage.setItem(CONSOLIDATION_KEY, JSON.stringify(session));
}

export function getConsolidation(): ConsolidationSession | null {
  const data = localStorage.getItem(CONSOLIDATION_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getTodayConsolidation(): ConsolidationSession | null {
  const session = getConsolidation();
  if (!session) return null;
  const today = new Date().toISOString().split('T')[0];
  return session.date === today ? session : null;
}

export function clearConsolidation(): void {
  localStorage.removeItem(CONSOLIDATION_KEY);
}

// Maturing bins management (persistent across days)
export function saveMaturingBins(bins: MaturingBin[]): void {
  localStorage.setItem(MATURING_BINS_KEY, JSON.stringify(bins));
}

export function getMaturingBins(): MaturingBin[] {
  const data = localStorage.getItem(MATURING_BINS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function addMaturingBin(bin: MaturingBin): void {
  const bins = getMaturingBins();
  bins.push(bin);
  saveMaturingBins(bins);
}

export function updateMaturingBin(bin: MaturingBin): void {
  const bins = getMaturingBins();
  const index = bins.findIndex(b => b.id === bin.id);
  if (index >= 0) {
    bins[index] = bin;
    saveMaturingBins(bins);
  }
}

export function getMaturingBinById(id: string): MaturingBin | null {
  const bins = getMaturingBins();
  return bins.find(b => b.id === id) || null;
}
