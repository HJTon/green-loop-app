import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Truck, Info, Loader2, AlertCircle } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { ReportSection } from '@/components/ReportSection';
import { ConsolidationBoard } from '@/components/consolidation/ConsolidationBoard';
import { ConsolidationProgress } from '@/components/consolidation/ConsolidationProgress';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import {
  generateId,
  getCurrentDate,
  getCurrentTime,
  getTodayConsolidation,
  saveConsolidation,
} from '@/utils/storage';
import type { DropOffRecord, PickupReport, ConsolidationSession } from '@/types';
import {
  createPickupTilesFromPickups,
  getAssignedCount,
  allPickupsAssigned,
} from '@/services/consolidationService';

export function DropOffPage() {
  const navigate = useNavigate();
  const { collector, route, pickups, dropOff, completeDropOff, sheetClients, addToast, queueEmailSend, queueMaturingBinWrite } = useApp();

  const farm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  // Calculate totals from today's pickups
  const completedPickups = pickups.filter(p => p.status === 'completed');
  const totalBins = completedPickups.reduce((sum, p) => sum + p.bins_collected, 0);

  // Form state
  const [notes, setNotes] = useState(dropOff?.notes || '');
  const [report, setReport] = useState<PickupReport | null>(dropOff?.report || null);

  // Consolidation state
  const [session, setSession] = useState<ConsolidationSession | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Initialize or restore consolidation session
  useEffect(() => {
    if (!collector) return;

    const existingSession = getTodayConsolidation();
    if (existingSession) {
      // Update session with any new pickups
      const newPickupTiles = createPickupTilesFromPickups(
        completedPickups.filter(p => !existingSession.pickupTiles.some(t => t.id.startsWith(`tile-${p.id}`))),
        sheetClients
      );

      if (newPickupTiles.length > 0) {
        const updatedSession = {
          ...existingSession,
          pickupTiles: [...existingSession.pickupTiles, ...newPickupTiles],
        };
        setSession(updatedSession);
        saveConsolidation(updatedSession);
      } else {
        setSession(existingSession);
      }
      return;
    }

    // Create new session
    const newSession: ConsolidationSession = {
      id: generateId(),
      date: getCurrentDate(),
      collectorId: collector.id,
      pickupTiles: createPickupTilesFromPickups(completedPickups, sheetClients),
      maturingBins: [],
      completedAt: null,
      activeBinId: null,
    };

    setSession(newSession);
    saveConsolidation(newSession);
  }, [collector, completedPickups.length, sheetClients]);

  // Save session whenever it changes
  useEffect(() => {
    if (session) {
      saveConsolidation(session);
    }
  }, [session]);

  useEffect(() => {
    if (!collector) {
      navigate('/');
    } else if (!farm) {
      navigate('/route');
    }
  }, [collector, farm, navigate]);

  if (!collector || !farm || !route || !session) {
    return null;
  }

  const assignedCount = getAssignedCount(session);
  const hasPickups = session.pickupTiles.length > 0;
  const isConsolidationComplete = hasPickups && allPickupsAssigned(session) && session.maturingBins.length > 0;
  const canComplete = isConsolidationComplete;

  const handleComplete = async () => {
    if (!canComplete) return;

    setIsExporting(true);

    try {
      // Export each bin to the maturing bins sheet via the offline queue
      // (falls through to localStorage on any non-2xx / network error so the
      // AppContext retry loop can drain it later).
      let sentCount = 0;
      let queuedCount = 0;
      for (const bin of session.maturingBins) {
        const ok = await queueMaturingBinWrite({
          bin,
          collectorName: collector.name,
          farmName: farm.farm_name,
        });
        if (ok) sentCount++; else queuedCount++;
      }

      // Mark consolidation as completed
      const completedSession: ConsolidationSession = {
        ...session,
        completedAt: new Date().toISOString(),
      };
      saveConsolidation(completedSession);

      // Complete the drop-off
      const finalReport: PickupReport | null = report?.issue ? report : null;
      const newDropOff: DropOffRecord = {
        id: dropOff?.id || generateId(),
        date: getCurrentDate(),
        time: getCurrentTime(),
        farm_id: farm.id,
        collector_id: collector.id,
        bins_dropped: totalBins,
        buckets_dropped: 0,
        notes,
        report: finalReport,
      };

      completeDropOff(newDropOff);

      // Queue report email if there's a report (offline-resilient)
      if (newDropOff.report && newDropOff.report.issue) {
        queueEmailSend({
          businessName: farm.farm_name,
          collectorName: collector.name,
          reportType: 'dropoff',
          report: newDropOff.report,
        });
      }

      if (queuedCount === 0) {
        addToast('success', `Exported ${sentCount} bin(s) to maturing sheet`);
      } else if (sentCount === 0) {
        addToast('info', `Saved ${queuedCount} bin(s) locally — will retry when you're back online`);
      } else {
        addToast('info', `Sent ${sentCount}, saved ${queuedCount} locally — the rest will retry when you're back online`);
      }
      navigate('/summary');
    } catch (error) {
      console.error('Drop-off finalisation error:', error);
      addToast('error', 'Something went wrong finishing drop-off - your data is saved locally');
      navigate('/summary');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Drop Off & Consolidation" showBack />

      {/* Farm Info */}
      <div className="bg-white px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2 text-green-primary mb-1">
          <Truck size={18} />
          <span className="text-sm font-medium">Destination Farm</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900">{farm.farm_name}</h2>
        <div className="flex items-center gap-1 text-sm text-gray-600 mt-0.5">
          <MapPin size={14} />
          <span>{farm.address}</span>
        </div>
        {farm.delivery_notes && (
          <div className="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <span className="text-sm text-amber-800">{farm.delivery_notes}</span>
          </div>
        )}
      </div>

      <ConsolidationProgress
        assigned={assignedCount}
        total={session.pickupTiles.length}
      />

      <div className="p-3">
        <ConsolidationBoard
          session={session}
          setSession={setSession}
          collectorId={collector.id}
          farmId={farm.id}
          addToast={addToast}
        />

        {hasPickups && !isConsolidationComplete && session.maturingBins.length > 0 && (
          <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Everything collected needs to be in a bin before you can finish.
            </p>
          </div>
        )}

        {/* Notes */}
        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Drop-off Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
            placeholder="Any notes about this drop-off..."
          />
        </div>

        {/* Report Section */}
        <div className="mt-4">
          <ReportSection report={report} onChange={setReport} />
        </div>

        {/* Complete Button */}
        <div className="mt-5">
          <Button
            fullWidth
            size="lg"
            onClick={handleComplete}
            disabled={!canComplete || isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 size={18} className="mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              'Complete Drop-off'
            )}
          </Button>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
