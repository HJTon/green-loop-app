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
import { Plus, Truck, AlertCircle, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { DraggablePickupTile } from '@/components/consolidation/DraggablePickupTile';
import { PickupTileCard } from '@/components/consolidation/PickupTileCard';
import { MaturingBinCard } from '@/components/consolidation/MaturingBinCard';
import { MaturingBinDropZone } from '@/components/consolidation/MaturingBinDropZone';
import { ConsolidationProgress } from '@/components/consolidation/ConsolidationProgress';
import { SerialNumberModal } from '@/components/consolidation/SerialNumberModal';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import { apiFetch } from '@/utils/apiClient';
import type { PickupTile, ConsolidationSession } from '@/types';
import {
  createPickupTilesFromPickups,
  createMaturingBin,
  addPickupToMaturingBin,
  removePickupFromMaturingBin,
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
  const { collector, route, pickups, sheetClients, addToast } = useApp();

  const [session, setSession] = useState<ConsolidationSession | null>(null);
  const [showSerialModal, setShowSerialModal] = useState(false);
  const [activeTile, setActiveTile] = useState<PickupTile | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);

  const farm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

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

  const handleAddBin = (serialNumber: string) => {
    const farmId = farm?.id || 'default';
    const newBin = createMaturingBin(serialNumber, collector.id, farmId);

    setSession(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        maturingBins: [...prev.maturingBins, newBin],
      };
    });

    addToast('success', `Added bin #${serialNumber}`);
  };

  const handleTileSelect = (tileId: string) => {
    setSelectedTileId(prev => (prev === tileId ? null : tileId));
  };

  const handleBinTap = (binId: string) => {
    if (!selectedTileId || !session) return;
    const tile = session.pickupTiles.find(t => t.id === selectedTileId);
    if (!tile || tile.isAssigned) {
      setSelectedTileId(null);
      return;
    }
    setSession(prev => {
      if (!prev) return prev;
      const updatedBins = prev.maturingBins.map(bin => {
        if (bin.id === binId) return addPickupToMaturingBin(bin, tile);
        return bin;
      });
      const updatedTiles = prev.pickupTiles.map(t => {
        if (t.id === selectedTileId) return { ...t, isAssigned: true };
        return t;
      });
      return { ...prev, maturingBins: updatedBins, pickupTiles: updatedTiles };
    });
    setSelectedTileId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const tile = event.active.data.current?.tile as PickupTile | undefined;
    setActiveTile(tile || null);
    setSelectedTileId(null); // clear tap selection when drag starts
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTile(null);

    const { active, over } = event;
    if (!over) return;

    const tileId = active.id as string;
    const dropId = over.id as string;

    // Check if dropping on a bin dropzone
    if (dropId.startsWith('dropzone-')) {
      const binId = dropId.replace('dropzone-', '');
      const tile = session.pickupTiles.find(t => t.id === tileId);

      if (tile && !tile.isAssigned) {
        setSession(prev => {
          if (!prev) return prev;

          // Find the bin and add the pickup
          const updatedBins = prev.maturingBins.map(bin => {
            if (bin.id === binId) {
              return addPickupToMaturingBin(bin, tile);
            }
            return bin;
          });

          // Mark tile as assigned
          const updatedTiles = prev.pickupTiles.map(t => {
            if (t.id === tileId) {
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
      }
    }
  };

  const handleRemoveFromBin = (binId: string, pickupTileId: string) => {
    setSession(prev => {
      if (!prev) return prev;

      // Remove from bin
      const updatedBins = prev.maturingBins.map(bin => {
        if (bin.id === binId) {
          return removePickupFromMaturingBin(bin, pickupTileId);
        }
        return bin;
      });

      // Mark tile as unassigned
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
    if (!canComplete || !collector) return;

    setIsExporting(true);

    try {
      // Export each bin to the maturing bins spreadsheet
      for (const bin of session.maturingBins) {
        const response = await apiFetch('/.netlify/functions/maturing-bins-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bin,
            collectorName: collector.name,
            farmName: farm?.farm_name || 'Unknown Farm',
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to export bin ${bin.serialNumber}`);
        }
      }

      // Mark session as completed
      const completedSession: ConsolidationSession = {
        ...session,
        completedAt: new Date().toISOString(),
      };
      saveConsolidation(completedSession);

      addToast('success', `Exported ${session.maturingBins.length} bin(s) to maturing sheet`);
      navigate('/dropoff');
    } catch (error) {
      console.error('Export error:', error);
      addToast('error', 'Failed to export. Will retry when you complete drop-off.');
      // Still allow navigation to drop-off
      navigate('/dropoff');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Bin Consolidation" showBack />

      {/* Progress */}
      <ConsolidationProgress
        assigned={assignedCount}
        total={session.pickupTiles.length}
      />

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="p-3">
          {/* Two-column layout: bins left, pickups right */}
          <div className="flex gap-2 items-start">
            {/* Left: Maturing Bins */}
            <div className="w-[44%] shrink-0">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Bins ({session.maturingBins.length})
              </h3>

              <div
                className="space-y-2 overflow-y-auto"
                style={{ maxHeight: 'calc(100dvh - 220px)' }}
              >
                {session.maturingBins.map(bin => (
                  <MaturingBinDropZone
                    key={bin.id}
                    binId={bin.id}
                    hasSelectedTile={selectedTileId !== null}
                    onBinTap={() => handleBinTap(bin.id)}
                  >
                    <MaturingBinCard
                      bin={bin}
                      compact
                      onRemoveContent={pickupTileId =>
                        handleRemoveFromBin(bin.id, pickupTileId)
                      }
                      hasSelectedTile={selectedTileId !== null}
                    />
                  </MaturingBinDropZone>
                ))}

                {/* Add bin button */}
                <button
                  onClick={() => setShowSerialModal(true)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-green-primary hover:text-green-primary hover:bg-green-50 transition-colors flex items-center justify-center gap-1 text-sm"
                >
                  <Plus size={16} />
                  <span>Add Bin</span>
                </button>
              </div>
            </div>

            {/* Right: Unassigned Pickups */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Pickups ({unassignedTiles.length})
                </h3>
                {unassignedTiles.length > 0 && (
                  <span className="text-xs text-gray-400">Tap to select</span>
                )}
              </div>

              <div
                className="overflow-y-auto"
                style={{ maxHeight: 'calc(100dvh - 220px)' }}
              >
                {!hasPickups ? (
                  <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 text-center">
                    <Truck size={24} className="text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600 font-medium text-sm">No pickups yet</p>
                  </div>
                ) : unassignedTiles.length === 0 ? (
                  <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                    <Truck size={24} className="text-green-primary mx-auto mb-2" />
                    <p className="text-green-800 font-medium text-sm">All assigned!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unassignedTiles.map(tile => (
                      <DraggablePickupTile
                        key={tile.id}
                        tile={tile}
                        isSelected={selectedTileId === tile.id}
                        onSelect={() => handleTileSelect(tile.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status messages */}
          {!hasPickups && (
            <div className="mt-4 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} className="text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800">
                Complete pickups on the route first. You can add bins here while you wait.
              </p>
            </div>
          )}
          {hasPickups && session.maturingBins.length === 0 && (
            <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Add at least one maturing bin and assign all pickups to complete.
              </p>
            </div>
          )}

          {/* Complete button */}
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

        {/* Drag overlay */}
        <DragOverlay>
          {activeTile && (
            <div className="w-64">
              <PickupTileCard tile={activeTile} isDragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Serial Number Modal */}
      <SerialNumberModal
        isOpen={showSerialModal}
        onClose={() => setShowSerialModal(false)}
        onSubmit={handleAddBin}
      />

      {/* Bottom padding */}
      <div className="h-8" />
    </div>
  );
}
