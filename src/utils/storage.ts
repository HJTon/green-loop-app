import type { PickupRecord, Route, RouteStop, RouteSplitState, DropOffRecord, ConsolidationSession, MaturingBin, AdHocReason, PickupReport, ReportRecipient, CollectionType } from '@/types';
import type { PendingWrite } from '@/types/sheet';

const PICKUPS_KEY = 'greenloop_pickups';
const ROUTE_STATE_KEY = 'greenloop_route_state';
const SESSION_KEY = 'greenloop_session';
const DROPOFF_KEY = 'greenloop_dropoff';
const PENDING_WRITES_KEY = 'greenloop_pending_writes';
const PENDING_NOTES_KEY = 'greenloop_pending_notes';
const PENDING_EMAILS_KEY = 'greenloop_pending_emails';
const PENDING_MATURING_BINS_KEY = 'greenloop_pending_maturing_bins';
const CONSOLIDATION_KEY = 'greenloop_consolidation';
const MATURING_BINS_KEY = 'greenloop_maturing_bins';
const ADHOC_STOPS_KEY = 'greenloop_adhoc_stops'; // keyed by date inside the JSON object
const ROUTE_SPLIT_KEY = 'greenloop_route_split';  // keyed by routeId inside the JSON object
const WELCOME_KIT_KEY = 'greenloop_welcome_kit';        // editable kit contents (string[])
const KIT_DELIVERED_KEY = 'greenloop_kit_delivered';    // { [`${date}|${clientId}`]: true }

// The welcome kit handed to a business on their first visit. Editable in Settings;
// these are the defaults used until an admin changes them.
export const DEFAULT_WELCOME_KIT_ITEMS = [
  '2 posters',
  '2 stickers',
  '2 flyers',
  'Box of Zing',
];

// Pending pickup-note writes to the Google Sheets "Pickup Notes" tab
export interface PendingNoteWrite {
  id: string;
  date: string;
  time: string;
  businessName: string;
  collectorName: string;
  status: 'completed' | 'skipped';
  binsCollected: number;
  notes: string;
  timestamp: string;
}

// Pending report emails via Resend
export interface PendingEmailSend {
  id: string;
  businessName: string;
  collectorName: string;
  reportType: 'pickup' | 'dropoff';
  report: PickupReport;
  photos: string[];
  recipients: ReportRecipient[];
  timestamp: string;
}

// Pending maturing-bin appends to the Bin Tracker tab. Same shape the
// `maturing-bins-write` Netlify function already takes as its body — we just
// stash it verbatim so the retry loop can POST it as-is.
export interface PendingMaturingBinWrite {
  id: string;
  bin: MaturingBin;
  collectorName: string;
  farmName: string;
  createdAt: string; // ISO — TTL / debugging
}

// A brand-new location added in the field that ISN'T in the schedule sheet.
// Stored in full so it can be rebuilt on reload without a sheet row.
export interface NewLocationInfo {
  business_name: string;
  address: string;
  collection_type: CollectionType;
  expected_quantity: number;
  delivery_notes: string;
}

// Ad-hoc stops added by the driver in the field (early pickups, etc.)
export interface AdHocStopRecord {
  client_id: string;
  reason: AdHocReason;
  added_at: string; // ISO timestamp
  // Present only for brand-new off-sheet locations (not in the schedule).
  new_location?: NewLocationInfo;
}

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
  const today = getCurrentDate();
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

// Two-run split state (per-stop run tags live on RouteStop and persist via
// saveRouteState; this holds the rest — endpoints, which run is active/first).
function getRouteSplits(): Record<string, RouteSplitState> {
  const data = localStorage.getItem(ROUTE_SPLIT_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function getRouteSplit(routeId: string): RouteSplitState | null {
  return getRouteSplits()[routeId] || null;
}

export function saveRouteSplit(state: RouteSplitState): void {
  const all = getRouteSplits();
  all[state.routeId] = state;
  localStorage.setItem(ROUTE_SPLIT_KEY, JSON.stringify(all));
}

export function clearRouteSplit(routeId: string): void {
  const all = getRouteSplits();
  delete all[routeId];
  localStorage.setItem(ROUTE_SPLIT_KEY, JSON.stringify(all));
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

// Get current date formatted (in local timezone)
export function getCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  localStorage.removeItem(ADHOC_STOPS_KEY);
  localStorage.removeItem(ROUTE_SPLIT_KEY);
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
  const today = getCurrentDate();
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

// Pending note writes (for Google Sheets "Pickup Notes" tab)
export function savePendingNote(note: PendingNoteWrite): void {
  const notes = getPendingNotes();
  const existingIndex = notes.findIndex(n => n.id === note.id);
  if (existingIndex >= 0) {
    notes[existingIndex] = note;
  } else {
    notes.push(note);
  }
  localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(notes));
}

export function getPendingNotes(): PendingNoteWrite[] {
  const data = localStorage.getItem(PENDING_NOTES_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function markNoteSynced(id: string): void {
  const notes = getPendingNotes().filter(n => n.id !== id);
  localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(notes));
}

export function clearAllPendingNotes(): void {
  localStorage.removeItem(PENDING_NOTES_KEY);
}

// Pending report emails
export function savePendingEmail(email: PendingEmailSend): void {
  const emails = getPendingEmails();
  const existingIndex = emails.findIndex(e => e.id === email.id);
  if (existingIndex >= 0) {
    emails[existingIndex] = email;
  } else {
    emails.push(email);
  }
  localStorage.setItem(PENDING_EMAILS_KEY, JSON.stringify(emails));
}

export function getPendingEmails(): PendingEmailSend[] {
  const data = localStorage.getItem(PENDING_EMAILS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function markEmailSynced(id: string): void {
  const emails = getPendingEmails().filter(e => e.id !== id);
  localStorage.setItem(PENDING_EMAILS_KEY, JSON.stringify(emails));
}

export function clearAllPendingEmails(): void {
  localStorage.removeItem(PENDING_EMAILS_KEY);
}

// Pending maturing-bin writes (for the "Bin Tracker" tab of the maturing-bins
// sheet). Same offline-then-retry pattern as writes / notes / emails above.
export function savePendingMaturingBin(entry: PendingMaturingBinWrite): void {
  const entries = getPendingMaturingBins();
  const existingIndex = entries.findIndex(e => e.id === entry.id);
  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
  localStorage.setItem(PENDING_MATURING_BINS_KEY, JSON.stringify(entries));
}

export function getPendingMaturingBins(): PendingMaturingBinWrite[] {
  const data = localStorage.getItem(PENDING_MATURING_BINS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function markMaturingBinSynced(id: string): void {
  const entries = getPendingMaturingBins().filter(e => e.id !== id);
  localStorage.setItem(PENDING_MATURING_BINS_KEY, JSON.stringify(entries));
}

export function clearAllPendingMaturingBins(): void {
  localStorage.removeItem(PENDING_MATURING_BINS_KEY);
}

// Selector for UI nudges — is there anything queued that hasn't landed yet?
export function hasPendingMaturingBins(): boolean {
  return getPendingMaturingBins().length > 0;
}

// Find completed pickups from earlier days that never made it through
// Consolidation. We only store one consolidation session at a time, so
// "consolidated" means: the currently stored session matches that pickup's
// date AND has completedAt set. Anything older than that (or from a different
// date) is treated as unsent to the compost monitor. Used by the route list
// banner to nudge the driver to open /consolidation and finish the job.
export function getUnconsolidatedOldPickups(): PickupRecord[] {
  const today = getCurrentDate();
  const consolidation = getConsolidation();
  const consolidatedDate =
    consolidation && consolidation.completedAt ? consolidation.date : null;

  return getPickups().filter(p => {
    if (p.status !== 'completed') return false;
    if (p.date >= today) return false; // today or future — not a "missed" day
    // If the one stored consolidation session matches this pickup's date and
    // is completed, treat as sent. Otherwise it's a candidate for the nudge.
    return p.date !== consolidatedDate;
  });
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
  const today = getCurrentDate();
  return session.date === today ? session : null;
}

export function clearConsolidation(): void {
  localStorage.removeItem(CONSOLIDATION_KEY);
}

// Ad-hoc stops (early pickups added by driver)
type AdHocStopsByDate = Record<string, AdHocStopRecord[]>;

function getAllAdHocStops(): AdHocStopsByDate {
  const data = localStorage.getItem(ADHOC_STOPS_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function getAdHocStopsForDate(date: string): AdHocStopRecord[] {
  const all = getAllAdHocStops();
  return all[date] || [];
}

export function saveAdHocStop(date: string, stop: AdHocStopRecord): void {
  const all = getAllAdHocStops();
  const existing = all[date] || [];
  // De-dupe by client_id
  if (!existing.find(s => s.client_id === stop.client_id)) {
    existing.push(stop);
  }
  all[date] = existing;
  localStorage.setItem(ADHOC_STOPS_KEY, JSON.stringify(all));
}

export function removeAdHocStop(date: string, clientId: string): void {
  const all = getAllAdHocStops();
  if (!all[date]) return;
  all[date] = all[date].filter(s => s.client_id !== clientId);
  localStorage.setItem(ADHOC_STOPS_KEY, JSON.stringify(all));
}

export function clearAdHocStopsForDate(date: string): void {
  const all = getAllAdHocStops();
  delete all[date];
  localStorage.setItem(ADHOC_STOPS_KEY, JSON.stringify(all));
}

// Welcome kit contents (editable in Settings, stored per-device)
export function getWelcomeKitItems(): string[] {
  const data = localStorage.getItem(WELCOME_KIT_KEY);
  if (!data) return [...DEFAULT_WELCOME_KIT_ITEMS];
  try {
    const items = JSON.parse(data);
    if (Array.isArray(items) && items.every(i => typeof i === 'string')) {
      return items;
    }
    return [...DEFAULT_WELCOME_KIT_ITEMS];
  } catch {
    return [...DEFAULT_WELCOME_KIT_ITEMS];
  }
}

export function saveWelcomeKitItems(items: string[]): void {
  const cleaned = items.map(i => i.trim()).filter(Boolean);
  localStorage.setItem(WELCOME_KIT_KEY, JSON.stringify(cleaned));
}

// Track which first-visit welcome kits have been handed over, keyed by date +
// client so the checklist doesn't nag again after it's confirmed or on reload.
function kitDeliveredKey(date: string, clientId: string): string {
  return `${date}|${clientId}`;
}

function getKitDeliveredMap(): Record<string, boolean> {
  const data = localStorage.getItem(KIT_DELIVERED_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function isKitDelivered(date: string, clientId: string): boolean {
  return getKitDeliveredMap()[kitDeliveredKey(date, clientId)] === true;
}

export function markKitDelivered(date: string, clientId: string): void {
  const map = getKitDeliveredMap();
  map[kitDeliveredKey(date, clientId)] = true;
  localStorage.setItem(KIT_DELIVERED_KEY, JSON.stringify(map));
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
