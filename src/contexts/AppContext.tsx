import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Collector, Route, PickupRecord, RouteStop, DropOffRecord, Client } from '@/types';
import type { PendingWrite } from '@/types/sheet';
import type { ToastMessage } from '@/components/Toast';
import { getCollectorById } from '@/utils/data';
import {
  loadCSV,
  getClientsForDate,
  getRouteForDate,
  getPickupWriteInfo,
  getAvailableDates,
  clearCache,
  writeBinCount,
} from '@/services/sheetDataService';
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
} from '@/utils/storage';

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
      const dateStr = date.toISOString().split('T')[0];
      const mergedRoute = dateStr === today ? mergeRouteWithState(newRoute) : newRoute;

      setSheetClients(clients);
      setRoute(mergedRoute);
      setSelectedDate(dateStr);
      setAvailableDates(getAvailableDates());

      console.log(`Loaded ${clients.length} pickups for ${dateStr}`);
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
    };

    initializeApp();
  }, [loadRouteForDate, syncPendingWrites]);

  // Set view date (for "View Other Days" feature)
  // TEMP: Allow completing pickups on any date for testing
  const setViewDate = useCallback(async (dateStr: string, _readOnly: boolean = false) => {
    const date = new Date(dateStr);

    setIsReadOnlyView(false); // TEMP: Always allow edits for testing
    await loadRouteForDate(date);
  }, [loadRouteForDate]);

  // Get client by ID from sheet clients
  const getClientById = useCallback((clientId: string): Client | undefined => {
    return sheetClients.find(c => c.id === clientId);
  }, [sheetClients]);

  // Record bin count (write to Google Sheets and save locally as backup)
  const recordBinCount = useCallback(async (clientId: string, count: number) => {
    const date = new Date(selectedDate);
    const writeInfo = getPickupWriteInfo(clientId, date);

    if (writeInfo) {
      const client = sheetClients.find(c => c.id === clientId);
      const rowToWrite = writeInfo.rowIndex + 1; // +1 to write in row below "Pick Up"

      // Save locally first (as backup)
      const newWrite: PendingWrite = {
        id: generateId(),
        rowIndex: rowToWrite,
        dateColumnIndex: writeInfo.dateColumnIndex,
        value: count.toString(),
        businessName: client?.business_name || clientId,
        date: selectedDate,
        timestamp: new Date().toISOString(),
      };
      savePendingWrite(newWrite);
      setPendingWrites(getPendingWrites());

      // Try to write to Google Sheets
      try {
        await writeBinCount(rowToWrite, writeInfo.dateColumnIndex, count.toString());
        // Success - remove from pending
        markWriteSynced(rowToWrite, writeInfo.dateColumnIndex);
        setPendingWrites(getPendingWrites());
        addToast('success', `${count} ${client?.collection_type || 'bins'} saved to sheet`);
        console.log(`Written ${count} bins for ${newWrite.businessName} to Google Sheets`);
      } catch (error) {
        console.error('Failed to write to Google Sheets (saved locally):', error);
        addToast('error', `Couldn't save to sheet - will retry`, {
          label: 'Retry Now',
          onClick: () => syncPendingWrites(),
        });
      }
    }
  }, [selectedDate, sheetClients, addToast, syncPendingWrites]);

  // Refresh data from CSV
  const refreshData = useCallback(async () => {
    clearCache();
    await loadRouteForDate(new Date(selectedDate));
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
