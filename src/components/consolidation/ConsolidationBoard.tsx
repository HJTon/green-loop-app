import { useState } from 'react';
import { Package, Plus, Check, Minus, AlertCircle, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/Button';
import { SerialNumberModal } from './SerialNumberModal';
import type { CollectionType, ConsolidationSession, MaturingBin } from '@/types';
import type { ToastMessage } from '@/components/Toast';
import {
  createMaturingBin,
  addPickupsToMaturingBin,
  groupUnassignedTiles,
  groupBinContents,
  getBinGroupForClient,
  getSuggestedBinSerials,
  formatReadyDate,
  type BusinessGroup,
} from '@/services/consolidationService';

interface ConsolidationBoardProps {
  session: ConsolidationSession;
  setSession: Dispatch<SetStateAction<ConsolidationSession | null>>;
  collectorId: string;
  farmId: string;
  addToast: (type: ToastMessage['type'], message: string) => void;
}

/**
 * The farm screen: one maturing bin is "active", and tapping a business drops
 * one of its bins into it.
 *
 * This replaced drag-and-drop on 2026-08-13. Dragging meant one gesture per
 * physical bin onto a target that was usually off-screen — 30+ drags on a big
 * day. Now it's one tap per bin, or one tap for all of a business's bins, with
 * no scrolling between two panels. Both /consolidation and /dropoff render this
 * same component; the old duplicated copies had drifted apart badly.
 */
export function ConsolidationBoard({
  session,
  setSession,
  collectorId,
  farmId,
  addToast,
}: ConsolidationBoardProps) {
  const [showSerialModal, setShowSerialModal] = useState(false);

  const activeBin =
    session.maturingBins.find(b => b.id === session.activeBinId) || null;
  const otherBins = session.maturingBins.filter(b => b.id !== session.activeBinId);
  const groups = groupUnassignedTiles(session);

  // Rows are the businesses with bins still to assign, plus any business whose
  // bins are ALL already in the bin being filled. Without that second part a
  // mis-tapped "All 4" leaves no way to take just one back — the row would
  // vanish the moment it emptied.
  const rows: Array<{
    key: string;
    clientId: string;
    businessName: string;
    collectionType: CollectionType;
    remaining: number;
    group?: BusinessGroup;
  }> = groups.map(g => ({
    key: g.key,
    clientId: g.clientId,
    businessName: g.businessName,
    collectionType: g.collectionType,
    remaining: g.tiles.length,
    group: g,
  }));

  if (activeBin) {
    for (const inBin of groupBinContents(activeBin)) {
      const alreadyListed = rows.some(
        r => r.clientId === inBin.clientId && r.collectionType === inBin.collectionType
      );
      if (!alreadyListed) {
        rows.push({
          key: inBin.key,
          clientId: inBin.clientId,
          businessName: inBin.businessName,
          collectionType: inBin.collectionType,
          remaining: 0,
        });
      }
    }
  }

  const setActiveBin = (binId: string | null) => {
    setSession(prev => (prev ? { ...prev, activeBinId: binId } : prev));
  };

  const handleCreateBin = (serialNumber: string) => {
    const duplicate = session.maturingBins.find(b => b.serialNumber === serialNumber);
    if (duplicate) {
      // Almost always means "I want to keep filling that one", so just reopen it.
      setActiveBin(duplicate.id);
      addToast('info', `Bin #${serialNumber} is already open — switched to it`);
      return;
    }

    const newBin = createMaturingBin(serialNumber, collectorId, farmId);
    setSession(prev =>
      prev
        ? { ...prev, maturingBins: [...prev.maturingBins, newBin], activeBinId: newBin.id }
        : prev
    );
    addToast('success', `Filling bin #${serialNumber}`);
  };

  /**
   * Move `count` of a business's unassigned bins into the active bin.
   *
   * Everything is recomputed from `prev` rather than the rendered `group`.
   * Two taps in quick succession land in the same React batch and both see
   * the pre-click render, so working from the closure would add the same
   * tiles twice — the bin ends up with duplicate contents while the progress
   * count stays put.
   */
  const addFromGroup = (group: BusinessGroup, count: number) => {
    setSession(prev => {
      if (!prev || !prev.activeBinId) return prev;

      const moving = prev.pickupTiles
        .filter(
          t =>
            !t.isAssigned &&
            t.clientId === group.clientId &&
            t.collectionType === group.collectionType
        )
        .slice(0, count);

      if (moving.length === 0) return prev;
      const movingIds = new Set(moving.map(t => t.id));

      return {
        ...prev,
        maturingBins: prev.maturingBins.map(bin =>
          bin.id === prev.activeBinId ? addPickupsToMaturingBin(bin, moving) : bin
        ),
        pickupTiles: prev.pickupTiles.map(t =>
          movingIds.has(t.id) ? { ...t, isAssigned: true } : t
        ),
      };
    });
  };

  /** Take the most recently added one back out of the active bin. */
  const removeOne = (clientId: string, collectionType: CollectionType) => {
    setSession(prev => {
      if (!prev || !prev.activeBinId) return prev;

      const bin = prev.maturingBins.find(b => b.id === prev.activeBinId);
      if (!bin) return prev;

      const mine = bin.contents.filter(
        c => c.clientId === clientId && c.collectionType === collectionType
      );
      if (mine.length === 0) return prev;

      const content = mine[mine.length - 1];

      return {
        ...prev,
        maturingBins: prev.maturingBins.map(b =>
          b.id === bin.id
            ? { ...b, contents: b.contents.filter(c => c.id !== content.id) }
            : b
        ),
        pickupTiles: prev.pickupTiles.map(t =>
          t.id === content.pickupTileId ? { ...t, isAssigned: false } : t
        ),
      };
    });
  };

  /** Remove a whole business's contribution from any bin (used on the chips). */
  const removeGroupFromBin = (binId: string, clientId: string, collectionType: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const bin = prev.maturingBins.find(b => b.id === binId);
      if (!bin) return prev;

      const removing = bin.contents.filter(
        c => c.clientId === clientId && c.collectionType === collectionType
      );
      const removingTileIds = new Set(removing.map(c => c.pickupTileId));

      return {
        ...prev,
        maturingBins: prev.maturingBins.map(b =>
          b.id === binId
            ? { ...b, contents: b.contents.filter(c => !removingTileIds.has(c.pickupTileId)) }
            : b
        ),
        pickupTiles: prev.pickupTiles.map(t =>
          removingTileIds.has(t.id) ? { ...t, isAssigned: false } : t
        ),
      };
    });
  };

  const unitLabel = (type: string, count: number) => {
    const base = type === 'buckets' ? 'bucket' : type === 'soil' ? 'soil bin' : 'bin';
    return count === 1 ? base : `${base}s`;
  };

  const binSummary = (bin: MaturingBin) => {
    const total = bin.contents.reduce((sum, c) => sum + c.binsCount, 0);
    return total;
  };

  return (
    <div className="space-y-3">
      {/* ── Active bin ─────────────────────────────────────────────────── */}
      {activeBin ? (
        <div className="bg-white rounded-xl border-2 border-green-primary overflow-hidden">
          <div className="px-3 py-2.5 bg-green-50 border-b border-green-200">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Package size={16} className="text-green-primary shrink-0" />
                  <span className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                    Filling now
                  </span>
                </div>
                <p className="font-bold text-gray-900 text-lg truncate">
                  #{activeBin.serialNumber}
                </p>
              </div>
              {/* Count only. The old "≈N L / 120 L" readout (and the warning
                  that went with it) came from a volume model that treats a
                  tipped-in 120L wheelie bin as 120L of maturing-bin space, so
                  it read 660L for a bin that physically holds 120L. Per-source
                  volume is still recorded on each content row for reporting. */}
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-gray-700">
                  {binSummary(activeBin)} in
                </p>
                <p className="text-xs text-gray-500">
                  {groupBinContents(activeBin).length} source
                  {groupBinContents(activeBin).length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-2.5">
            {activeBin.contents.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-2">
                Empty — tap a business below to add to it
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {groupBinContents(activeBin).map(group => (
                  <span
                    key={group.key}
                    className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-2.5 pr-1 py-1 text-xs"
                  >
                    <span className="font-medium text-gray-800">{group.businessName}</span>
                    <span className="text-gray-500">×{group.count}</span>
                    <button
                      type="button"
                      onClick={() =>
                        removeGroupFromBin(activeBin.id, group.clientId, group.collectionType)
                      }
                      className="p-1 -m-0.5 text-gray-400 hover:text-red-500"
                      aria-label={`Remove ${group.businessName} from bin ${activeBin.serialNumber}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-2.5">
              <Button variant="outline" fullWidth onClick={() => setActiveBin(null)}>
                <Check size={16} className="mr-1.5" />
                Finish this bin
              </Button>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-1.5">
              Ready {formatReadyDate(activeBin.readyDate)}
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowSerialModal(true)}
          className="w-full py-5 rounded-xl border-2 border-dashed border-green-primary/50 bg-green-50/50 text-green-800 flex flex-col items-center justify-center gap-1"
        >
          <Plus size={22} />
          <span className="font-semibold">Start a maturing bin</span>
          <span className="text-xs text-green-700/80">
            Scan or type the wheelie bin you&apos;re filling
          </span>
        </button>
      )}

      {/* ── Today's other bins — tap to reopen ─────────────────────────── */}
      {otherBins.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Other bins today — tap to add more
          </p>
          <div className="flex flex-wrap gap-1.5">
            {otherBins.map(bin => (
              <button
                key={bin.id}
                type="button"
                onClick={() => setActiveBin(bin.id)}
                className="inline-flex items-center gap-1.5 bg-white border-2 border-gray-200 rounded-full px-3 py-1.5 text-sm hover:border-green-primary active:bg-green-50"
              >
                <Package size={13} className="text-gray-400" />
                <span className="font-semibold text-gray-800">#{bin.serialNumber}</span>
                <span className="text-xs text-gray-500">{binSummary(bin)}</span>
              </button>
            ))}
            {activeBin && (
              <button
                type="button"
                onClick={() => setShowSerialModal(true)}
                className="inline-flex items-center gap-1 border-2 border-dashed border-gray-300 rounded-full px-3 py-1.5 text-sm text-gray-500 hover:border-green-primary hover:text-green-primary"
              >
                <Plus size={13} />
                New bin
              </button>
            )}
          </div>
        </div>
      )}

      {activeBin && otherBins.length === 0 && (
        <button
          type="button"
          onClick={() => setShowSerialModal(true)}
          className="w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-green-primary hover:text-green-primary flex items-center justify-center gap-1 text-sm"
        >
          <Plus size={15} />
          Start another bin
        </button>
      )}

      {/* ── To assign ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            To assign ({groups.reduce((sum, g) => sum + g.tiles.length, 0)})
          </h3>
          {activeBin && groups.length > 0 && (
            <span className="text-[11px] text-gray-400">Tap a row to add one</span>
          )}
        </div>

        {session.pickupTiles.length === 0 ? (
          <div className="bg-white border-2 border-gray-200 rounded-xl p-4 text-center">
            <p className="text-gray-500 text-sm">Nothing collected yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {groups.length === 0 && (
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                <Check size={22} className="text-green-primary mx-auto mb-1" />
                <p className="text-green-800 font-medium text-sm">Everything&apos;s in a bin</p>
              </div>
            )}
            {rows.map(row => {
              const inActive = activeBin
                ? getBinGroupForClient(activeBin, row.clientId, row.collectionType)
                : undefined;
              const { remaining } = row;

              return (
                <div
                  key={row.key}
                  className={`bg-white rounded-xl border-2 transition-colors ${
                    !activeBin
                      ? 'border-gray-100 opacity-60'
                      : remaining === 0
                      ? 'border-gray-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-stretch">
                    {/* Tap the row to add one */}
                    <button
                      type="button"
                      disabled={!activeBin || remaining === 0}
                      onClick={() => row.group && addFromGroup(row.group, 1)}
                      className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-3 text-left disabled:cursor-not-allowed"
                    >
                      <span
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                          remaining === 0
                            ? 'bg-green-50 text-green-primary'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {remaining === 0 ? <Check size={16} /> : remaining}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block font-semibold truncate ${
                            remaining === 0 ? 'text-gray-500' : 'text-gray-900'
                          }`}
                        >
                          {row.businessName}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {remaining > 0
                            ? `${remaining} ${unitLabel(row.collectionType, remaining)} left`
                            : 'all in'}
                          {inActive ? ` · ${inActive.count} in #${activeBin?.serialNumber}` : ''}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-1 pr-2 shrink-0">
                      {inActive && inActive.count > 0 && (
                        <button
                          type="button"
                          onClick={() => removeOne(row.clientId, row.collectionType)}
                          className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-100"
                          aria-label={`Take one ${row.businessName} back out`}
                        >
                          <Minus size={16} />
                        </button>
                      )}
                      {remaining > 1 && (
                        <button
                          type="button"
                          disabled={!activeBin}
                          onClick={() => row.group && addFromGroup(row.group, remaining)}
                          className="h-9 px-2.5 rounded-lg bg-green-primary text-white text-xs font-semibold flex items-center justify-center active:opacity-80 disabled:bg-gray-200 disabled:text-gray-400"
                        >
                          All {remaining}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!activeBin && groups.length > 0 && (
          <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Start a maturing bin above, then tap businesses to fill it.
            </p>
          </div>
        )}
      </div>

      <SerialNumberModal
        isOpen={showSerialModal}
        onClose={() => setShowSerialModal(false)}
        onSubmit={handleCreateBin}
        suggestions={getSuggestedBinSerials(session)}
      />
    </div>
  );
}
