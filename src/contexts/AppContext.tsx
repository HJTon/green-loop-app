import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Collector, Route, PickupRecord, RouteStop, DropOffRecord, Client, AdHocReason, PickupReport, CollectionType } from '@/types';
import type { PendingWrite } from '@/types/sheet';
import type { ToastMessage } from '@/components/Toast';
import { getCollectorById } from '@/utils/data';
import { runGeocodeSweep } from '@/utils/geocodeCache';
import {
  loadCSV,
  getClientsForDate,
  getRouteForDate,
  getPickupWriteInfo,
  getAdHocWriteInfo,
  getAllClients,
  getAvailableDates,
  clearCache,
  writeBinCount,
  writePickupNote,
  writeSiteInfo,
  writeManualOverride,
} from '@/services/sheetDataService';
import { sendReportEmail } from '@/services/emailService';
import {
  getSession,
  saveSession,
  clearSession,
  getTodayPickups,
  savePickup,
  mergeRouteWithState,
  saveRouteState,
  clearAllData,
  getTodayDropOff,
  saveDropOff,
  generateId,
  getCurrentDate,
  savePendingWrite,
  getPendingWrites,
  clearAllPendingWrites,
  markWriteSynced,
  getAdHocStopsForDate,
  saveAdHocStop,
  removeAdHocStop,
  savePendingNote,
  getPendingNotes,
  markNoteSynced,
  clearAllPendingNotes,
  savePendingEmail,
  getPendingEmails,
  markEmailSynced,
  clearAllPendingEmails,
  type PendingNoteWrite,
  type PendingEmailSend,
} from '@/utils/storage';

// Parse YYYY-MM-DD date string in local timezone (avoids UTC shift)
function parseDateLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

interface AppContextType {
  // Existing state
  collector: Collector | null;
  route: Route | null;
  pickups: PickupRecord[];
  dropOff: DropOffRecord | null;

  // New state for sheet integration
  isLoading: boolean;
  loadError: string | null;
  selectedDate: string;
  isReadOnlyView: boolean;
  sheetClients: Client[];
  pendingWrites: PendingWrite[];
  availableDates: Date[];
  isSyncing: boolean;

  // Toast notifications
  toasts: ToastMessage[];
  addToast: (type: ToastMessage['type'], message: string, action?: ToastMessage['action']) => void;
  dismissToast: (id: string) => void;

  // Existing functions
  login: (collector: Collector) => void;
  logout: () => void;
  addPickup: (pickup: PickupRecord) => void;
  updatePickup: (pickup: PickupRecord) => void;
  updateStopStatus: (clientId: string, status: RouteStop['status']) => void;
  getStopStatus: (clientId: string) => RouteStop['status'];
  reorderStops: (oldIndex: number, newIndex: number) => void;
  applyStopOrder: (orderedClientIds: string[]) => void;
  completeDropOff: (dropOff: DropOffRecord) => void;
  resetDay: () => void;
  completedCount: number;
  totalStops: number;
  allPickupsComplete: boolean;

  // New functions for sheet integration
  loadRouteForDate: (date: Date) => Promise<void>;
  setViewDate: (date: string, readOnly?: boolean) => void;
  recordBinCount: (clientId: string, count: number) => Promise<void>;
  getClientById: (clientId: string) => Client | undefined;
  refreshData: () => Promise<void>;
  syncPendingWrites: () => Promise<void>;

  // Queued note + email operations (offline-resilient)
  queueNoteWrite: (params: Omit<PendingNoteWrite, 'id' | 'timestamp'>) => Promise<void>;
  queueEmailSend: (params: {
    businessName: string;
    collectorName: string;
    reportType: 'pickup' | 'dropoff';
    report: PickupReport;
    photos?: string[];
  }) => Promise<void>;
  syncPendingNotes: () => Promise<void>;
  syncPendingEmails: () => Promise<void>;

  // Ad-hoc / early pickup support
  getAllClientsForPicker: () => Client[];
  addAdHocStop: (clientId: string, reason: AdHocReason) => boolean;
  // Add a brand-new location not in the schedule sheet. Returns its client id.
  addNewLocationStop: (info: {
    businessName: string;
    address: string;
    collectionType: CollectionType;
    expectedQuantity: number;
    deliveryNotes?: string;
    reason: AdHocReason;
  }) => string;
  removeAdHocStopFromRoute: (clientId: string) => void;

  // "How to find the bins" per-site help (editable in the field)
  saveSiteInfo: (clientId: string, data: { instructions: string; media: string[] }) => Promise<void>;
  // Manual lat/lng override for stops the geocoder can't place. Pass null/null
  // to clear an existing override. Persists to columns N/O on the sheet.
  saveClientLocationOverride: (clientId: string, lat: number | null, lng: number | null) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Existing state
  const [collector, setCollector] = useState<Collector | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [pickups, setPickups] = useState<PickupRecord[]>([]);
  const [dropOff, setDropOff] = useState<DropOffRecord | null>(null);

  // New state for sheet integration
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(getCurrentDate());
  const [isReadOnlyView, setIsReadOnlyView] = useState(false);
  const [sheetClients, setSheetClients] = useState<Client[]>([]);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Toast notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], message: string, action?: ToastMessage['action']) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message, action }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Sync pending writes to Google Sheets
  const syncPendingWrites = useCallback(async () => {
    const writes = getPendingWrites();
    if (writes.length === 0) return;

    setIsSyncing(true);
    let successCount = 0;
    let failCount = 0;

    for (const write of writes) {
      try {
        await writeBinCount(write.rowIndex, write.dateColumnIndex, write.value);
        markWriteSynced(write.rowIndex, write.dateColumnIndex);
        successCount++;
      } catch (error) {
        console.error(`Failed to sync write for ${write.businessName}:`, error);
        failCount++;
      }
    }

    setPendingWrites(getPendingWrites());
    setIsSyncing(false);

    if (successCount > 0 && failCount === 0) {
      addToast('success', `Synced ${successCount} pickup${successCount > 1 ? 's' : ''} to sheet`);
    } else if (failCount > 0) {
      addToast('error', `${failCount} pickup${failCount > 1 ? 's' : ''} failed to sync`, {
        label: 'Retry',
        onClick: () => syncPendingWrites(),
      });
    }
  }, [addToast]);

  // Sync pending pickup-note writes to the "Pickup Notes" tab
  const syncPendingNotes = useCallback(async () => {
    const notes = getPendingNotes();
    if (notes.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const note of notes) {
      try {
        await writePickupNote({
          date: note.date,
          time: note.time,
          businessName: note.businessName,
          collectorName: note.collectorName,
          status: note.status,
          binsCollected: note.binsCollected,
          notes: note.notes,
        });
        markNoteSynced(note.id);
        successCount++;
      } catch (error) {
        console.error(`Failed to sync note for ${note.businessName}:`, error);
        failCount++;
      }
    }

    if (successCount > 0 && failCount === 0) {
      console.log(`Synced ${successCount} pending note${successCount > 1 ? 's' : ''}`);
    } else if (failCount > 0) {
      addToast('error', `${failCount} note${failCount > 1 ? 's' : ''} failed to sync`, {
        label: 'Retry',
        onClick: () => syncPendingNotes(),
      });
    }
  }, [addToast]);

  // Sync pending report emails via Resend
  const syncPendingEmails = useCallback(async () => {
    const emails = getPendingEmails();
    if (emails.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const email of emails) {
      try {
        const ok = await sendReportEmail({
          businessName: email.businessName,
          collectorName: email.collectorName,
          reportType: email.reportType,
          report: { ...email.report, recipients: email.recipients },
          photos: email.photos,
        });
        if (ok) {
          markEmailSynced(email.id);
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(`Failed to send report email for ${email.businessName}:`, error);
        failCount++;
      }
    }

    if (successCount > 0 && failCount === 0) {
      console.log(`Sent ${successCount} pending report email${successCount > 1 ? 's' : ''}`);
    } else if (failCount > 0) {
      addToast('error', `${failCount} report email${failCount > 1 ? 's' : ''} failed to send`, {
        label: 'Retry',
        onClick: () => syncPendingEmails(),
      });
    }
  }, [addToast]);

  // Queue a pickup-note write: save locally first, try network, toast on failure
  const queueNoteWrite = useCallback(async (params: Omit<PendingNoteWrite, 'id' | 'timestamp'>) => {
    const note: PendingNoteWrite = {
      ...params,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };
    savePendingNote(note);

    try {
      await writePickupNote({
        date: note.date,
        time: note.time,
        businessName: note.businessName,
        collectorName: note.collectorName,
        status: note.status,
        binsCollected: note.binsCollected,
        notes: note.notes,
      });
      markNoteSynced(note.id);
    } catch (error) {
      console.error(`Failed to write pickup note for ${note.businessName} (queued for retry):`, error);
      addToast('error', `Couldn't save note to sheet - will retry`, {
        label: 'Retry Now',
        onClick: () => syncPendingNotes(),
      });
    }
  }, [addToast, syncPendingNotes]);

  // Queue a report email send: save locally first, try network, toast on failure
  const queueEmailSend = useCallback(async (params: {
    businessName: string;
    collectorName: string;
    reportType: 'pickup' | 'dropoff';
    report: PickupReport;
    photos?: string[];
  }) => {
    // Don't queue if there's no issue to report
    if (!params.report?.issue || params.report.issue.trim() === '') return;

    const email: PendingEmailSend = {
      id: generateId(),
      businessName: params.businessName,
      collectorName: params.collectorName,
      reportType: params.reportType,
      report: params.report,
      photos: params.photos || [],
      recipients: params.report.recipients || [],
      timestamp: new Date().toISOString(),
    };
    savePendingEmail(email);

    try {
      const ok = await sendReportEmail({
        businessName: email.businessName,
        collectorName: email.collectorName,
        reportType: email.reportType,
        report: { ...email.report, recipients: email.recipients },
        photos: email.photos,
      });
      if (ok) {
        markEmailSynced(email.id);
      } else {
        addToast('error', `Couldn't send report email - will retry`, {
          label: 'Retry Now',
          onClick: () => syncPendingEmails(),
        });
      }
    } catch (error) {
      console.error(`Failed to send report email for ${email.businessName} (queued for retry):`, error);
      addToast('error', `Couldn't send report email - will retry`, {
        label: 'Retry Now',
        onClick: () => syncPendingEmails(),
      });
    }
  }, [addToast, syncPendingEmails]);

  // Load route for a specific date
  const loadRouteForDate = useCallback(async (date: Date) => {
    setIsLoading(true);
    setLoadError(null);

    try {
      // Load CSV data if not already loaded
      await loadCSV();

      // Get clients and route for the date
      const clients = await getClientsForDate(date);
      const newRoute = await getRouteForDate(date);

      // Merge with saved state (for today only)
      const today = getCurrentDate();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const baseMerged = dateStr === today ? mergeRouteWithState(newRoute) : newRoute;

      // Layer in any ad-hoc stops the driver added for this date
      const adHocRecords = getAdHocStopsForDate(dateStr);
      const allClientsList = getAllClients();
      const adHocClients: Client[] = [];
      const adHocStops: RouteStop[] = [];

      let nextPosition = baseMerged.stops.length;
      for (const record of adHocRecords) {
        // Skip if the client is already on the regular route (would be a duplicate)
        if (baseMerged.stops.some(s => s.client_id === record.client_id)) continue;

        // A brand-new off-sheet location: rebuild the client from the stored
        // payload (it has no sheet row to look up).
        if (record.new_location) {
          const nl = record.new_location;
          adHocClients.push({
            id: record.client_id,
            business_name: nl.business_name,
            contact_name: '',
            contact_phone: '',
            contact_email: '',
            address: nl.address,
            delivery_notes: nl.delivery_notes,
            collection_type: nl.collection_type,
            expected_quantity: nl.expected_quantity,
            collection_frequency: 'Weekly',
            price_per_unit: 0,
            paper_towel_pickup: false,
            special_instructions: '',
            logo_url: null,
            active: true,
          });
          nextPosition += 1;
          adHocStops.push({
            client_id: record.client_id,
            position: nextPosition,
            status: 'pending',
            notes: '',
            isAdHoc: true,
            adHocReason: record.reason,
            isNewLocation: true,
          });
          continue;
        }

        const adHocClient = allClientsList.find(c => c.id === record.client_id);
        if (!adHocClient) continue; // Stale ad-hoc reference (client removed from sheet)

        adHocClients.push(adHocClient);
        nextPosition += 1;
        adHocStops.push({
          client_id: record.client_id,
          position: nextPosition,
          status: 'pending',
          notes: '',
          isAdHoc: true,
          adHocReason: record.reason,
        });
      }

      // Apply saved route-state status to ad-hoc stops too (so completing one survives reload)
      const savedStateStops = baseMerged.stops; // already merged above
      const adHocStopsWithSavedStatus = adHocStops.map(stop => {
        const saved = savedStateStops.find(s => s.client_id === stop.client_id);
        return saved ? { ...stop, status: saved.status, notes: saved.notes } : stop;
      });

      const mergedRoute: Route = {
        ...baseMerged,
        stops: [...baseMerged.stops, ...adHocStopsWithSavedStatus],
      };

      setSheetClients([...clients, ...adHocClients]);
      setRoute(mergedRoute);
      setSelectedDate(dateStr);
      setAvailableDates(getAvailableDates());

      console.log(`Loaded ${clients.length} pickups + ${adHocStops.length} ad-hoc for ${dateStr}`);
    } catch (error) {
      console.error('Error loading route:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load route data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize from storage on mount
  useEffect(() => {
    const initializeApp = async () => {
      // Restore session
      const session = getSession();
      if (session) {
        const savedCollector = getCollectorById(session.collectorId);
        if (savedCollector) {
          setCollector(savedCollector);
        }
      }

      // Load today's route from sheet
      await loadRouteForDate(new Date());

      // Load today's pickups from storage
      setPickups(getTodayPickups());

      // Load today's drop-off
      setDropOff(getTodayDropOff());

      // Load pending writes
      const pending = getPendingWrites();
      setPendingWrites(pending);

      // Try to sync any pending writes
      if (pending.length > 0) {
        console.log(`Found ${pending.length} pending writes, attempting sync...`);
        // Delay sync slightly so UI loads first
        setTimeout(() => {
          syncPendingWrites();
        }, 1000);
      }

      // Retry any pending notes / emails from prior sessions
      const pendingNotesCount = getPendingNotes().length;
      const pendingEmailsCount = getPendingEmails().length;
      if (pendingNotesCount > 0) {
        console.log(`Found ${pendingNotesCount} pending note(s), attempting sync...`);
        setTimeout(() => syncPendingNotes(), 1500);
      }
      if (pendingEmailsCount > 0) {
        console.log(`Found ${pendingEmailsCount} pending email(s), attempting send...`);
        setTimeout(() => syncPendingEmails(), 2000);
      }
    };

    initializeApp();
  }, [loadRouteForDate, syncPendingWrites, syncPendingNotes, syncPendingEmails]);

  // Background self-healing: re-run the geocoder chain for any address that
  // failed >24 h ago. Runs once on boot (after the UI has settled) and on a
  // 24-hour interval while the app is open. The sweep itself filters by
  // staleness so back-to-back triggers within a session are no-ops.
  useEffect(() => {
    const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const bootTimer = setTimeout(() => {
      runGeocodeSweep().catch(err =>
        console.warn('Boot geocode sweep failed:', err)
      );
    }, 5000);
    const intervalTimer = setInterval(() => {
      runGeocodeSweep().catch(err =>
        console.warn('Scheduled geocode sweep failed:', err)
      );
    }, SWEEP_INTERVAL_MS);
    return () => {
      clearTimeout(bootTimer);
      clearInterval(intervalTimer);
    };
  }, []);

  // Set view date (for "View Other Days" feature)
  // TEMP: Allow completing pickups on any date for testing
  const setViewDate = useCallback(async (dateStr: string, _readOnly: boolean = false) => {
    const date = parseDateLocal(dateStr);

    setIsReadOnlyView(false); // TEMP: Always allow edits for testing
    await loadRouteForDate(date);
  }, [loadRouteForDate]);

  // Get client by ID from sheet clients
  const getClientById = useCallback((clientId: string): Client | undefined => {
    return sheetClients.find(c => c.id === clientId);
  }, [sheetClients]);

  // Record bin count (write to Google Sheets and save locally as backup)
  const recordBinCount = useCallback(async (clientId: string, count: number) => {
    const date = parseDateLocal(selectedDate);
    const client = sheetClients.find(c => c.id === clientId);
    const stop = route?.stops.find(s => s.client_id === clientId);
    const isAdHoc = stop?.isAdHoc === true;

    // Helper that queues + tries a single write
    const queueAndWrite = async (rowIndex: number, dateColumnIndex: number, value: string, label: string) => {
      const newWrite: PendingWrite = {
        id: generateId(),
        rowIndex,
        dateColumnIndex,
        value,
        businessName: client?.business_name || clientId,
        date: selectedDate,
        timestamp: new Date().toISOString(),
      };
      savePendingWrite(newWrite);
      setPendingWrites(getPendingWrites());

      try {
        await writeBinCount(rowIndex, dateColumnIndex, value);
        markWriteSynced(rowIndex, dateColumnIndex);
        setPendingWrites(getPendingWrites());
        console.log(`Written ${label} for ${newWrite.businessName} to Google Sheets`);
        return true;
      } catch (error) {
        console.error(`Failed to write ${label} to Google Sheets (saved locally):`, error);
        return false;
      }
    };

    if (isAdHoc) {
      // Ad-hoc / early pickup: write both the "Pick Up" marker and the count
      const writeInfo = getAdHocWriteInfo(clientId, date);
      if (!writeInfo) {
        addToast('error', `Couldn't find ${client?.business_name || clientId} in the sheet`);
        return;
      }

      const markerOk = await queueAndWrite(writeInfo.rowIndex, writeInfo.dateColumnIndex, 'Pick Up', 'Pick Up marker');
      const countOk = await queueAndWrite(writeInfo.rowIndex + 1, writeInfo.dateColumnIndex, count.toString(), `${count} bins`);

      if (markerOk && countOk) {
        addToast('success', `Early pickup saved (${count} ${client?.collection_type || 'bins'})`);
      } else {
        addToast('error', `Couldn't save early pickup to sheet - will retry`, {
          label: 'Retry Now',
          onClick: () => syncPendingWrites(),
        });
      }
      return;
    }

    // Regular scheduled pickup
    const writeInfo = getPickupWriteInfo(clientId, date);
    if (writeInfo) {
      const ok = await queueAndWrite(writeInfo.rowIndex + 1, writeInfo.dateColumnIndex, count.toString(), `${count} bins`);
      if (ok) {
        addToast('success', `${count} ${client?.collection_type || 'bins'} saved to sheet`);
      } else {
        addToast('error', `Couldn't save to sheet - will retry`, {
          label: 'Retry Now',
          onClick: () => syncPendingWrites(),
        });
      }
    }
  }, [selectedDate, sheetClients, route, addToast, syncPendingWrites]);

  // Return every client in the spreadsheet for the ad-hoc picker
  const getAllClientsForPicker = useCallback((): Client[] => {
    return getAllClients();
  }, []);

  // Add an ad-hoc / early pickup stop to today's route.
  // Returns false if the client is already on the route (caller can show a message).
  const addAdHocStopFn = useCallback((clientId: string, reason: AdHocReason): boolean => {
    if (!route) return false;
    if (route.stops.some(s => s.client_id === clientId)) return false;

    // Make sure we have the client in sheetClients so getClientById resolves it
    const allClients = getAllClients();
    const adHocClient = allClients.find(c => c.id === clientId);
    if (!adHocClient) return false;

    const newStop: RouteStop = {
      client_id: clientId,
      position: route.stops.length + 1,
      status: 'pending',
      notes: '',
      isAdHoc: true,
      adHocReason: reason,
    };

    const newStops = [...route.stops, newStop];
    const newRoute = { ...route, stops: newStops };

    setRoute(newRoute);
    setSheetClients(prev => (prev.find(c => c.id === clientId) ? prev : [...prev, adHocClient]));
    saveRouteState(route.id, newStops);
    saveAdHocStop(selectedDate, {
      client_id: clientId,
      reason,
      added_at: new Date().toISOString(),
    });

    return true;
  }, [route, selectedDate]);

  // Save (or clear) a per-client manual lat/lng override. Optimistically
  // updates the open route so the optimiser sees the new coord without
  // waiting for a sheet refresh, then writes to columns N/O.
  const saveClientLocationOverride = useCallback(async (
    clientId: string,
    lat: number | null,
    lng: number | null
  ) => {
    const client = sheetClients.find(c => c.id === clientId);
    if (!client) return;

    const prevLat = client.manual_lat ?? null;
    const prevLng = client.manual_lng ?? null;

    setSheetClients(prev => prev.map(c =>
      c.id === clientId
        ? { ...c, manual_lat: lat, manual_lng: lng }
        : c
    ));

    try {
      await writeManualOverride(client.business_name, lat, lng);
      if (lat == null || lng == null) {
        addToast('success', 'Cleared the manual pin');
      } else {
        addToast('success', 'Saved pinned location');
      }
    } catch (error) {
      console.error('Failed to save manual override:', error);
      // Roll back the optimistic change so the badge stays accurate.
      setSheetClients(prev => prev.map(c =>
        c.id === clientId
          ? { ...c, manual_lat: prevLat, manual_lng: prevLng }
          : c
      ));
      addToast('error', "Couldn't save pin to sheet - your changes weren't kept");
      throw error;
    }
  }, [sheetClients, addToast]);

  // Save "how to find the bins" help for a site. Updates local state so the
  // open page reflects it immediately, then persists to the Site Info tab.
  const saveSiteInfo = useCallback(async (
    clientId: string,
    data: { instructions: string; media: string[] }
  ) => {
    const client = sheetClients.find(c => c.id === clientId);
    if (!client) return;

    setSheetClients(prev => prev.map(c =>
      c.id === clientId
        ? { ...c, find_instructions: data.instructions, find_media: data.media }
        : c
    ));

    try {
      await writeSiteInfo(client.business_name, data.instructions, data.media);
      addToast('success', 'Saved how to find the bins');
    } catch (error) {
      console.error('Failed to save site info:', error);
      addToast('error', "Couldn't save to sheet - your changes are kept on this device");
    }
  }, [sheetClients, addToast]);

  // Add a brand-new location that isn't in the schedule sheet. It's recorded to
  // the Pickup Notes tab at completion (not the invoicing grid), and stored in
  // full locally so it survives a reload. Returns the synthetic client id.
  const addNewLocationStopFn = useCallback((info: {
    businessName: string;
    address: string;
    collectionType: CollectionType;
    expectedQuantity: number;
    deliveryNotes?: string;
    reason: AdHocReason;
  }): string => {
    const clientId = `adhoc-${generateId()}`;
    const deliveryNotes = info.deliveryNotes || '';

    const newClient: Client = {
      id: clientId,
      business_name: info.businessName,
      contact_name: '',
      contact_phone: '',
      contact_email: '',
      address: info.address,
      delivery_notes: deliveryNotes,
      collection_type: info.collectionType,
      expected_quantity: info.expectedQuantity,
      collection_frequency: 'Weekly',
      price_per_unit: 0,
      paper_towel_pickup: false,
      special_instructions: '',
      logo_url: null,
      active: true,
    };

    const basePosition = route?.stops.length ?? 0;
    const newStop: RouteStop = {
      client_id: clientId,
      position: basePosition + 1,
      status: 'pending',
      notes: '',
      isAdHoc: true,
      adHocReason: info.reason,
      isNewLocation: true,
    };

    const newStops = [...(route?.stops ?? []), newStop];
    if (route) {
      setRoute({ ...route, stops: newStops });
      saveRouteState(route.id, newStops);
    }
    setSheetClients(prev => [...prev, newClient]);
    saveAdHocStop(selectedDate, {
      client_id: clientId,
      reason: info.reason,
      added_at: new Date().toISOString(),
      new_location: {
        business_name: info.businessName,
        address: info.address,
        collection_type: info.collectionType,
        expected_quantity: info.expectedQuantity,
        delivery_notes: deliveryNotes,
      },
    });

    return clientId;
  }, [route, selectedDate]);

  // Remove an ad-hoc stop from today's route (e.g. driver added by mistake)
  const removeAdHocStopFromRoute = useCallback((clientId: string) => {
    if (!route) return;
    const stop = route.stops.find(s => s.client_id === clientId);
    if (!stop || !stop.isAdHoc) return; // Only allow removing ad-hoc stops this way

    const newStops = route.stops
      .filter(s => s.client_id !== clientId)
      .map((s, i) => ({ ...s, position: i + 1 }));
    const newRoute = { ...route, stops: newStops };

    setRoute(newRoute);
    saveRouteState(route.id, newStops);
    removeAdHocStop(selectedDate, clientId);
  }, [route, selectedDate]);

  // Refresh data from CSV
  const refreshData = useCallback(async () => {
    clearCache();
    await loadRouteForDate(parseDateLocal(selectedDate));
  }, [selectedDate, loadRouteForDate]);

  const login = (newCollector: Collector) => {
    setCollector(newCollector);
    saveSession(newCollector.id);
  };

  const logout = () => {
    setCollector(null);
    clearSession();
  };

  const resetDay = async () => {
    clearAllData();
    clearAllPendingWrites();
    clearAllPendingNotes();
    clearAllPendingEmails();
    setCollector(null);
    setPickups([]);
    setDropOff(null);
    setPendingWrites([]);
    setIsReadOnlyView(false);
    // Reload fresh route
    clearCache();
    await loadRouteForDate(new Date());
  };

  const completeDropOff = (newDropOff: DropOffRecord) => {
    saveDropOff(newDropOff);
    setDropOff(newDropOff);
  };

  const addPickup = (pickup: PickupRecord) => {
    savePickup(pickup);
    setPickups(prev => [...prev, pickup]);
  };

  const updatePickup = (pickup: PickupRecord) => {
    savePickup(pickup);
    setPickups(prev => prev.map(p => (p.id === pickup.id ? pickup : p)));
  };

  const updateStopStatus = (clientId: string, status: RouteStop['status']) => {
    if (!route) return;

    const newStops = route.stops.map(stop =>
      stop.client_id === clientId ? { ...stop, status } : stop
    );

    const newRoute = { ...route, stops: newStops };
    setRoute(newRoute);
    saveRouteState(route.id, newStops);
  };

  const getStopStatus = (clientId: string): RouteStop['status'] => {
    if (!route) return 'pending';
    const stop = route.stops.find(s => s.client_id === clientId);
    return stop?.status || 'pending';
  };

  const reorderStops = (oldIndex: number, newIndex: number) => {
    if (!route) return;

    const sortedStops = [...route.stops].sort((a, b) => a.position - b.position);
    const [movedStop] = sortedStops.splice(oldIndex, 1);
    sortedStops.splice(newIndex, 0, movedStop);

    // Update positions
    const newStops = sortedStops.map((stop, index) => ({
      ...stop,
      position: index + 1,
    }));

    const newRoute = { ...route, stops: newStops };
    setRoute(newRoute);
    saveRouteState(route.id, newStops);
  };

  // Apply an explicit ordering of (pending) stops. Stops not in the provided
  // list keep their existing relative order and trail at the end - typically
  // these are already-completed/skipped stops the optimiser left alone.
  const applyStopOrder = (orderedClientIds: string[]) => {
    if (!route) return;

    const remaining = [...route.stops].sort((a, b) => a.position - b.position);
    const newStops: RouteStop[] = [];

    for (const id of orderedClientIds) {
      const idx = remaining.findIndex(s => s.client_id === id);
      if (idx === -1) continue;
      newStops.push(remaining.splice(idx, 1)[0]);
    }
    // Append anything not covered by the supplied order.
    newStops.push(...remaining);

    const repositioned = newStops.map((stop, i) => ({ ...stop, position: i + 1 }));
    const newRoute = { ...route, stops: repositioned };
    setRoute(newRoute);
    saveRouteState(route.id, repositioned);
  };

  const completedCount = route?.stops.filter(s => s.status === 'completed' || s.status === 'skipped').length || 0;
  const totalStops = route?.stops.length || 0;
  const allPickupsComplete = completedCount === totalStops && totalStops > 0;

  return (
    <AppContext.Provider
      value={{
        // Existing
        collector,
        route,
        pickups,
        dropOff,
        login,
        logout,
        addPickup,
        updatePickup,
        updateStopStatus,
        getStopStatus,
        reorderStops,
        applyStopOrder,
        completeDropOff,
        resetDay,
        completedCount,
        totalStops,
        allPickupsComplete,
        // New for sheet integration
        isLoading,
        loadError,
        selectedDate,
        isReadOnlyView,
        sheetClients,
        pendingWrites,
        availableDates,
        isSyncing,
        toasts,
        addToast,
        dismissToast,
        loadRouteForDate,
        setViewDate,
        recordBinCount,
        getClientById,
        refreshData,
        syncPendingWrites,
        getAllClientsForPicker,
        addAdHocStop: addAdHocStopFn,
        addNewLocationStop: addNewLocationStopFn,
        removeAdHocStopFromRoute,
        saveSiteInfo,
        saveClientLocationOverride,
        queueNoteWrite,
        queueEmailSend,
        syncPendingNotes,
        syncPendingEmails,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
