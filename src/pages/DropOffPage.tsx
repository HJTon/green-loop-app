import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { MapPin, Truck, Info, Loader2, AlertCircle, Package } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { ReportSection } from '@/components/ReportSection';
import { DraggablePickupTile } from '@/components/consolidation/DraggablePickupTile';
import { PickupTileCard } from '@/components/consolidation/PickupTileCard';
import { MaturingBinCard } from '@/components/consolidation/MaturingBinCard';
import { MaturingBinDropZone } from '@/components/consolidation/MaturingBinDropZone';
import { ConsolidationProgress } from '@/components/consolidation/ConsolidationProgress';
import { SerialNumberModal } from '@/components/consolidation/SerialNumberModal';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import { sendReportEmail } from '@/services/emailService';
import {
  generateId,
  getCurrentDate,
  getCurrentTime,
  getTodayConsolidation,
  saveConsolidation,
} from '@/utils/storage';
import type { DropOffRecord, PickupReport, ConsolidationSession, PickupTile, MaturingBin } from '@/types';
import {
  createPickupTilesFromPickups,
  createMaturingBin,
  addPickupToMaturingBin,
  removePickupFromMaturingBin,
  getUnassignedTiles,
  getAssignedCount,
  allPickupsAssigned,
  getVolumeWarning,
  calculateMaturingBinVolume,
  BIN_CAPACITY_LITRES,
} from '@/services/consolidationService';
import { useDroppable } from '@dnd-kit/core';

// New maturing bin drop zone component
function NewMaturingBinZone() {
  const { isOver, setNodeRef } = useDroppable({
    id: 'new-maturing-bin',
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-full p-6 rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center gap-2 ${
        isOver
          ? 'border-green-primary bg-green-50 text-green-primary'
          : 'border-gray-300 text-gray-400'
      }`}
    >
      <Package size={32} />
      <span className="text-sm font-medium">Drag a bin here to start maturing</span>
      <span className="text-xs">(Bins only - buckets need a bin first)</span>
    </div>
  );
}

export function DropOffPage() {
  const navigate = useNavigate();
  const { collector, route, pickups, dropOff, completeDropOff, sheetClients, addToast } = useApp();

  const farm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  // Calculate totals from today's pickups
  const completedPickups = pickups.filter(p => p.status === 'completed');
  const totalBins = completedPickups.reduce((sum, p) => sum + p.bins_collected, 0);

  // Form state
  const [notes, setNotes] = useState(dropOff?.notes || '');
  const [report, setReport] = useState<PickupReport | null>(dropOff?.report || null);

  // Consolidation state
  const [session, setSession] = useState<ConsolidationSession | null>(null);
  const [activeTile, setActiveTile] = useState<PickupTile | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Modal state for new bin creation
  const [showSerialModal, setShowSerialModal] = useState(false);
  const [pendingTileForNewBin, setPendingTileForNewBin] = useState<PickupTile | null>(null);

  // Capacity warning state
  const [showCapacityWarning, setShowCapacityWarning] = useState(false);
  const [pendingOverflowDrop, setPendingOverflowDrop] = useState<{
    tile: PickupTile;
    binId: string;
    warning: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );

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

  const unassignedTiles = getUnassignedTiles(session);
  const assignedCount = getAssignedCount(session);
  const hasPickups = session.pickupTiles.length > 0;
  const isConsolidationComplete = hasPickups && allPickupsAssigned(session) && session.maturingBins.length > 0;
  const canComplete = isConsolidationComplete;

  const handleDragStart = (event: DragStartEvent) => {
    const tile = event.active.data.current?.tile as PickupTile | undefined;
    setActiveTile(tile || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTile(null);

    const { active, over } = event;
    if (!over) return;

    const tileId = active.id as string;
    const dropId = over.id as string;
    const tile = session.pickupTiles.find(t => t.id === tileId);

    if (!tile || tile.isAssigned) return;

    // Dropping on "new maturing bin" zone
    if (dropId === 'new-maturing-bin') {
      // Only bins can create new maturing bins
      if (tile.collectionType !== 'bins') {
        addToast('error', 'Maturing needs to happen in a wheelie bin. Drag a bin first, then add buckets to it.');
        return;
      }

      // Use the tile's serial number from pickup (captured at pickup time)
      if (tile.serialNumber) {
        // Create bin directly with the serial number from pickup
        const newBin = createMaturingBin(tile.serialNumber, collector.id, farm.id);
        const binWithContent = addPickupToMaturingBin(newBin, tile);

        setSession(prev => {
          if (!prev) return prev;

          const updatedTiles = prev.pickupTiles.map(t => {
            if (t.id === tile.id) {
              return { ...t, isAssigned: true };
            }
            return t;
          });

          return {
            ...prev,
            maturingBins: [...prev.maturingBins, binWithContent],
            pickupTiles: updatedTiles,
          };
        });

        addToast('success', `Created maturing bin #${tile.serialNumber}`);
        return;
      }

      // Fallback: if no serial number, show modal (shouldn't happen with new flow)
      setPendingTileForNewBin(tile);
      setShowSerialModal(true);
      return;
    }

    // Dropping on existing maturing bin
    if (dropId.startsWith('dropzone-')) {
      const binId = dropId.replace('dropzone-', '');
      const targetBin = session.maturingBins.find(b => b.id === binId);

      if (!targetBin) return;

      // Check capacity warning
      const warning = getVolumeWarning(targetBin, tile);
      if (warning) {
        setPendingOverflowDrop({ tile, binId, warning });
        setShowCapacityWarning(true);
        return;
      }

      // Add to bin
      addTileToBin(tile, binId);
    }
  };

  const addTileToBin = (tile: PickupTile, binId: string) => {
    setSession(prev => {
      if (!prev) return prev;

      const updatedBins = prev.maturingBins.map(bin => {
        if (bin.id === binId) {
          return addPickupToMaturingBin(bin, tile);
        }
        return bin;
      });

      const updatedTiles = prev.pickupTiles.map(t => {
        if (t.id === tile.id) {
          return { ...t, isAssigned: true };
        }
        return t;
      });

      return {
        ...prev,
        maturingBins: updatedBins,
        pickupTiles: updatedTiles,
      };
    });
  };

  const handleSerialSubmit = (serialNumber: string) => {
    if (!pendingTileForNewBin) return;

    // Create the new maturing bin with the tile already inside
    const newBin = createMaturingBin(serialNumber, collector.id, farm.id);
    const binWithContent = addPickupToMaturingBin(newBin, pendingTileForNewBin);

    setSession(prev => {
      if (!prev) return prev;

      // Mark the tile as assigned
      const updatedTiles = prev.pickupTiles.map(t => {
        if (t.id === pendingTileForNewBin.id) {
          return { ...t, isAssigned: true };
        }
        return t;
      });

      return {
        ...prev,
        maturingBins: [...prev.maturingBins, binWithContent],
        pickupTiles: updatedTiles,
      };
    });

    addToast('success', `Created maturing bin #${serialNumber}`);
    setPendingTileForNewBin(null);
  };

  const handleConfirmOverflow = () => {
    if (!pendingOverflowDrop) return;

    addTileToBin(pendingOverflowDrop.tile, pendingOverflowDrop.binId);
    addToast('info', 'Added despite exceeding capacity');
    setShowCapacityWarning(false);
    setPendingOverflowDrop(null);
  };

  const handleCancelOverflow = () => {
    setShowCapacityWarning(false);
    setPendingOverflowDrop(null);
  };

  const handleRemoveFromBin = (binId: string, pickupTileId: string) => {
    setSession(prev => {
      if (!prev) return prev;

      const updatedBins = prev.maturingBins.map(bin => {
        if (bin.id === binId) {
          return removePickupFromMaturingBin(bin, pickupTileId);
        }
        return bin;
      });

      const updatedTiles = prev.pickupTiles.map(t => {
        if (t.id === pickupTileId) {
          return { ...t, isAssigned: false };
        }
        return t;
      });

      return {
        ...prev,
        maturingBins: updatedBins,
        pickupTiles: updatedTiles,
      };
    });
  };

  const handleComplete = async () => {
    if (!canComplete) return;

    setIsExporting(true);

    try {
      // Export each bin to the maturing bins spreadsheet
      for (const bin of session.maturingBins) {
        const response = await fetch('/.netlify/functions/maturing-bins-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bin,
            collectorName: collector.name,
            farmName: farm.farm_name,
          }),
        });

        if (!response.ok) {
          console.error(`Failed to export bin ${bin.serialNumber}`);
        }
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

      // Send email notification if there's a report
      if (newDropOff.report && newDropOff.report.issue) {
        sendReportEmail({
          businessName: farm.farm_name,
          collectorName: collector.name,
          reportType: 'dropoff',
          report: newDropOff.report,
        });
      }

      addToast('success', `Exported ${session.maturingBins.length} bin(s) to maturing sheet`);
      navigate('/summary');
    } catch (error) {
      console.error('Export error:', error);
      addToast('error', 'Failed to export to sheet, but drop-off saved locally');
      navigate('/summary');
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to show bin volume
  const getBinVolumeDisplay = (bin: MaturingBin) => {
    const volume = calculateMaturingBinVolume(bin);
    const percentage = Math.round((volume / BIN_CAPACITY_LITRES) * 100);
    return { volume: Math.round(volume), percentage };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Drop Off & Consolidation" showBack />

      {/* Farm Info */}
      <div className="bg-white px-4 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2 text-green-primary mb-2">
          <Truck size={20} />
          <span className="text-sm font-medium">Destination Farm</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900">{farm.farm_name}</h2>
        <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
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

      {/* Collection Summary */}
      <div className="bg-green-50 px-4 py-3 border-b border-green-200">
        <div className="flex gap-6">
          <div>
            <p className="text-2xl font-bold text-green-primary">{totalBins}</p>
            <p className="text-sm text-green-700">bins/buckets</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-primary">{completedPickups.length}</p>
            <p className="text-sm text-green-700">pickups</p>
          </div>
        </div>
      </div>

      {/* Consolidation Progress */}
      <ConsolidationProgress
        assigned={assignedCount}
        total={session.pickupTiles.length}
      />

      {/* Consolidation Section */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="p-4">
          {/* Instructions */}
          <div className="mb-4 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-800">
              Drag a bin to the maturing zone to start. Add more bins/buckets to combine contents - the first bin's serial number will be used.
            </p>
          </div>

          {/* Two sections side by side on larger screens */}
          <div className="lg:flex lg:gap-6">
            {/* Collected Bins/Buckets */}
            <div className="lg:w-1/2 mb-6 lg:mb-0">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Collected ({unassignedTiles.length} unassigned)
              </h3>

              {!hasPickups ? (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 text-center">
                  <p className="text-gray-500 text-sm">No bins/buckets to assign</p>
                </div>
              ) : unassignedTiles.length === 0 ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                  <p className="text-green-800 font-medium">All bins/buckets assigned!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unassignedTiles.map(tile => (
                    <DraggablePickupTile key={tile.id} tile={tile} />
                  ))}
                </div>
              )}
            </div>

            {/* Maturing Bins */}
            <div className="lg:w-1/2">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Maturing Bins ({session.maturingBins.length})
              </h3>

              <div className="space-y-3">
                {session.maturingBins.map(bin => {
                  const { volume, percentage } = getBinVolumeDisplay(bin);
                  return (
                    <MaturingBinDropZone key={bin.id} binId={bin.id}>
                      <div className="relative">
                        <MaturingBinCard
                          bin={bin}
                          onRemoveContent={pickupTileId =>
                            handleRemoveFromBin(bin.id, pickupTileId)
                          }
                        />
                        {/* Volume indicator */}
                        <div className={`absolute top-2 right-2 text-xs px-2 py-1 rounded-full font-medium ${
                          percentage > 100 ? 'bg-red-100 text-red-700' :
                          percentage > 80 ? 'bg-amber-100 text-amber-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {volume}L / {BIN_CAPACITY_LITRES}L
                        </div>
                      </div>
                    </MaturingBinDropZone>
                  );
                })}

                {/* New maturing bin drop zone */}
                <NewMaturingBinZone />
              </div>
            </div>
          </div>

          {/* Warning if not ready */}
          {hasPickups && !isConsolidationComplete && (
            <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                {session.maturingBins.length === 0
                  ? 'Drag a bin to the maturing zone to start consolidating.'
                  : 'Assign all collected bins/buckets to maturing bins to complete drop-off.'}
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="mt-6">
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
          <div className="mt-6">
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

        {/* Drag overlay */}
        <DragOverlay>
          {activeTile && (
            <div className="w-64">
              <PickupTileCard tile={activeTile} isDragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Serial Number Modal - for new bin creation */}
      <SerialNumberModal
        isOpen={showSerialModal}
        onClose={() => {
          setShowSerialModal(false);
          setPendingTileForNewBin(null);
        }}
        onSubmit={handleSerialSubmit}
      />

      {/* Capacity Warning Modal */}
      {showCapacityWarning && pendingOverflowDrop && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 bg-amber-50">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertCircle size={20} />
                <h2 className="text-lg font-semibold">Capacity Warning</h2>
              </div>
            </div>
            <div className="p-4">
              <p className="text-gray-700 mb-4">{pendingOverflowDrop.warning}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancelOverflow} fullWidth>
                  Cancel
                </Button>
                <Button onClick={handleConfirmOverflow} fullWidth>
                  Add Anyway
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-8" />
    </div>
  );
}
