import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { ConsolidationBoard } from '@/components/consolidation/ConsolidationBoard';
import { ConsolidationProgress } from '@/components/consolidation/ConsolidationProgress';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import type { ConsolidationSession } from '@/types';
import {
  createPickupTilesFromPickups,
  getUnassignedTiles,
  getAssignedCount,
  allPickupsAssigned,
} from '@/services/consolidationService';
import {
  saveConsolidation,
  getTodayConsolidation,
  generateId,
  getCurrentDate,
} from '@/utils/storage';

export function ConsolidationPage() {
  const navigate = useNavigate();
  const { collector, route, pickups, sheetClients, addToast, queueMaturingBinWrite } = useApp();

  const [session, setSession] = useState<ConsolidationSession | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const farm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  // Initialize or restore session
  useEffect(() => {
    if (!collector) {
      navigate('/');
      return;
    }

    const completedPickups = pickups.filter(p => p.status === 'completed');

    // Try to restore existing session
    const existingSession = getTodayConsolidation();
    if (existingSession) {
      // Update session with any new pickups that weren't in the original session
      const existingTileIds = new Set(existingSession.pickupTiles.map(t => t.clientId));
      const newPickupTiles = createPickupTilesFromPickups(
        completedPickups.filter(p => !existingTileIds.has(p.client_id)),
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

    // Create new session from today's pickups (can be empty)
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
  }, [collector, pickups, sheetClients, navigate]);

  // Save session whenever it changes
  useEffect(() => {
    if (session) {
      saveConsolidation(session);
    }
  }, [session]);

  if (!session || !collector) {
    return null;
  }

  const unassignedTiles = getUnassignedTiles(session);
  const assignedCount = getAssignedCount(session);
  const hasPickups = session.pickupTiles.length > 0;
  const canComplete = hasPickups && allPickupsAssigned(session) && session.maturingBins.length > 0;

  const handleComplete = async () => {
    if (!canComplete || !collector) return;

    setIsExporting(true);

    try {
      // Export each bin to the maturing bins sheet. queueMaturingBinWrite
      // returns true when the POST landed, false when it fell through to the
      // offline queue — either way we mark the session complete and let the
      // AppContext retry loop drain any queued writes on next boot / manual
      // sync. The count of queued writes drives the copy on the toast.
      let sentCount = 0;
      let queuedCount = 0;
      for (const bin of session.maturingBins) {
        const ok = await queueMaturingBinWrite({
          bin,
          collectorName: collector.name,
          farmName: farm?.farm_name || 'Unknown Farm',
        });
        if (ok) sentCount++; else queuedCount++;
      }

      // Mark session as completed
      const completedSession: ConsolidationSession = {
        ...session,
        completedAt: new Date().toISOString(),
      };
      saveConsolidation(completedSession);

      if (queuedCount === 0) {
        addToast('success', `Exported ${sentCount} bin(s) to maturing sheet`);
      } else if (sentCount === 0) {
        addToast('info', `Saved ${queuedCount} bin(s) locally — will retry when you're back online`);
      } else {
        addToast('info', `Sent ${sentCount}, saved ${queuedCount} locally — the rest will retry when you're back online`);
      }
      navigate('/dropoff');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Bin Consolidation" showBack />

      <ConsolidationProgress
        assigned={assignedCount}
        total={session.pickupTiles.length}
      />

      <div className="p-3">
        <ConsolidationBoard
          session={session}
          setSession={setSession}
          collectorId={collector.id}
          farmId={farm?.id || 'default'}
          addToast={addToast}
        />

        {!hasPickups && (
          <div className="mt-4 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <AlertCircle size={16} className="text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800">
              Complete pickups on the route first. You can add bins here while you wait.
            </p>
          </div>
        )}

        <div className="mt-4">
          <Button
            fullWidth
            size="lg"
            onClick={handleComplete}
            disabled={!canComplete || isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 size={18} className="mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              'Complete Consolidation'
            )}
          </Button>
          {!canComplete && hasPickups && session.maturingBins.length > 0 && unassignedTiles.length > 0 && (
            <p className="text-sm text-gray-500 text-center mt-2">
              Assign all pickups to maturing bins to continue
            </p>
          )}
          {!hasPickups && (
            <p className="text-sm text-gray-500 text-center mt-2">
              Complete pickups on the route first
            </p>
          )}
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
