import { useState } from 'react';
import { Package, Plus, Check, ArrowDownToLine, Layers, X, AlertCircle, ScanLine } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/Button';
import { SerialNumberModal } from './SerialNumberModal';
import { ScanBinsModal } from './ScanBinsModal';
import type { ConsolidationSession, MaturingBin, PickupTile } from '@/types';
import type { ToastMessage } from '@/components/Toast';
import {
  createMaturingBin,
  addPickupsToMaturingBin,
  getSortedUnassignedTiles,
  sortedBinContents,
  binItemCount,
  fullnessLabel,
  containerLabel,
  canHostMaturing,
  formatReadyDate,
} from '@/services/consolidationService';

interface ConsolidationBoardProps {
  session: ConsolidationSession;
  setSession: Dispatch<SetStateAction<ConsolidationSession | null>>;
  collectorId: string;
  farmId: string;
  addToast: (type: ToastMessage['type'], message: string) => void;
}

/**
 * The farm screen.
 *
 * Everything collected is ONE flat list of physical containers — bins first,
 * then buckets, fullest at the top — each showing its serial, where it came
 * from and how full it is. That is what you are looking at when you're stood
 * in front of the pile; grouping by business (the previous design) hid the
 * serials, which are the only thing that tells two bins apart.
 *
 * Two ways to work, matching what actually happens:
 *   "Straight in"  — full bins that need nothing added. Tick them off the
 *                    list and each becomes its own row, no mixing.
 *   "Build a bin"  — pick the bin you'll fill FIRST, out of the same list, and
 *                    everything you tap after that goes into it.
 *
 * The bin you pick to fill is one of the bins on the truck, so its own
 * contents are in it from the moment you choose it (`hostTileId`) — you don't
 * have to remember to also add it, and you can't take it back out without
 * scrapping the bin.
 *
 * The serial pop-up is now only for a bin that ISN'T in the list — a spare
 * empty one at the farm, or one whose serial didn't get scanned at pickup. It
 * used to offer every bin from the run, including ones already tipped out,
 * which is a second list of the same thing only wronger.
 */

type Mode = 'idle' | 'straight-in' | 'pick-host';

// What the serial pop-up is being used for when it opens.
type SerialPurpose =
  | { kind: 'empty-bin' }                    // a spare bin, not from the run
  | { kind: 'host'; tileId: string }         // this bin, serial never scanned
  | { kind: 'straight-in'; tileId: string }; // ditto, going in as it stands

export function ConsolidationBoard({
  session,
  setSession,
  collectorId,
  farmId,
  addToast,
}: ConsolidationBoardProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [serialPurpose, setSerialPurpose] = useState<SerialPurpose | null>(null);
  const [scanning, setScanning] = useState(false);

  const activeBin = session.maturingBins.find(b => b.id === session.activeBinId) || null;
  const otherBins = session.maturingBins.filter(b => b.id !== session.activeBinId);
  const tiles = getSortedUnassignedTiles(session);

  const setActiveBin = (binId: string | null) => {
    setSession(prev => (prev ? { ...prev, activeBinId: binId } : prev));
  };

  const leaveMode = () => {
    setMode('idle');
    setSelected(new Set());
    setScanning(false);
  };

  // Bins still to sort, in list order — everything the straight-in flow can
  // act on, whether it's tapped or scanned.
  const binCandidates = tiles.filter(canHostMaturing);
  const fullBins = binCandidates.filter(t => t.averageFullness >= 100);

  // ── Making a bin out of one of the collected bins ─────────────────────────
  //
  // Everything is recomputed from `prev` rather than the rendered tile. Two
  // taps in quick succession land in the same React batch and both see the
  // pre-click render, so working from the closure would assign the same tile
  // twice — the bin ends up with duplicate contents while the progress count
  // stays put.

  const makeBinFromTile = (tileId: string, serialOverride: string | undefined, keepFilling: boolean) => {
    setSession(prev => {
      if (!prev) return prev;
      const tile = prev.pickupTiles.find(t => t.id === tileId);
      if (!tile || tile.isAssigned) return prev;

      const serial = serialOverride || tile.serialNumber;
      if (!serial) return prev;

      const duplicate = prev.maturingBins.find(b => b.serialNumber === serial);
      if (duplicate) return { ...prev, activeBinId: duplicate.id };

      const hosted: PickupTile = { ...tile, serialNumber: serial };
      const bin: MaturingBin = {
        ...createMaturingBin(serial, collectorId, farmId),
        hostTileId: tile.id,
      };

      return {
        ...prev,
        maturingBins: [...prev.maturingBins, addPickupsToMaturingBin(bin, [hosted])],
        pickupTiles: prev.pickupTiles.map(t =>
          t.id === tile.id ? { ...hosted, isAssigned: true } : t
        ),
        // Only "build a bin" leaves it open; a straight-in bin is finished.
        activeBinId: keepFilling ? bin.id : prev.activeBinId,
      };
    });
  };

  const startBuildFrom = (tile: PickupTile) => {
    if (!tile.serialNumber) {
      setSerialPurpose({ kind: 'host', tileId: tile.id });
      return;
    }
    makeBinFromTile(tile.id, undefined, true);
    setMode('idle');
    setSelected(new Set());
    addToast('success', `Filling bin #${tile.serialNumber}`);
  };

  /** A spare empty bin at the farm — nothing from the run goes in it yet. */
  const createEmptyBin = (serialNumber: string) => {
    const duplicate = session.maturingBins.find(b => b.serialNumber === serialNumber);
    if (duplicate) {
      setActiveBin(duplicate.id);
      addToast('info', `Bin #${serialNumber} is already open — switched to it`);
      leaveMode();
      return;
    }

    const bin = createMaturingBin(serialNumber, collectorId, farmId);
    setSession(prev =>
      prev
        ? { ...prev, maturingBins: [...prev.maturingBins, bin], activeBinId: bin.id }
        : prev
    );
    addToast('success', `Filling bin #${serialNumber}`);
    leaveMode();
  };

  // ── Straight in ───────────────────────────────────────────────────────────

  const toggleSelected = (tile: PickupTile) => {
    if (!tile.serialNumber) {
      setSerialPurpose({ kind: 'straight-in', tileId: tile.id });
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tile.id)) next.delete(tile.id);
      else next.add(tile.id);
      return next;
    });
  };

  /** Tick every full bin at once — the common case on a good day. */
  const selectAllFull = () => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const tile of fullBins) {
        if (tile.serialNumber) next.add(tile.id);
      }
      return next;
    });
  };

  const confirmStraightIn = (ids: Set<string> = selected) => {
    const chosen = tiles.filter(t => ids.has(t.id));
    if (chosen.length === 0) return;
    for (const tile of chosen) {
      makeBinFromTile(tile.id, undefined, false);
    }
    addToast(
      'success',
      `${chosen.length} bin${chosen.length === 1 ? '' : 's'} straight to maturation`
    );
    leaveMode();
  };

  // ── Filling the open bin ──────────────────────────────────────────────────

  const addToActiveBin = (tileId: string) => {
    setSession(prev => {
      if (!prev || !prev.activeBinId) return prev;
      const tile = prev.pickupTiles.find(t => t.id === tileId);
      if (!tile || tile.isAssigned) return prev;

      return {
        ...prev,
        maturingBins: prev.maturingBins.map(bin =>
          bin.id === prev.activeBinId ? addPickupsToMaturingBin(bin, [tile]) : bin
        ),
        pickupTiles: prev.pickupTiles.map(t =>
          t.id === tile.id ? { ...t, isAssigned: true } : t
        ),
      };
    });
  };

  /** Take one container back out of a bin and return it to the list. */
  const removeContent = (binId: string, contentId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const bin = prev.maturingBins.find(b => b.id === binId);
      if (!bin) return prev;
      const content = bin.contents.find(c => c.id === contentId);
      if (!content) return prev;
      // The bin can't be tipped out of itself.
      if (content.pickupTileId === bin.hostTileId) return prev;

      return {
        ...prev,
        maturingBins: prev.maturingBins.map(b =>
          b.id === binId ? { ...b, contents: b.contents.filter(c => c.id !== contentId) } : b
        ),
        pickupTiles: prev.pickupTiles.map(t =>
          t.id === content.pickupTileId ? { ...t, isAssigned: false } : t
        ),
      };
    });
  };

  /** Scrap a bin entirely — everything in it, its own load included, goes back. */
  const scrapBin = (binId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const bin = prev.maturingBins.find(b => b.id === binId);
      if (!bin) return prev;
      const freed = new Set(bin.contents.map(c => c.pickupTileId));

      return {
        ...prev,
        maturingBins: prev.maturingBins.filter(b => b.id !== binId),
        pickupTiles: prev.pickupTiles.map(t =>
          freed.has(t.id) ? { ...t, isAssigned: false } : t
        ),
        activeBinId: prev.activeBinId === binId ? null : prev.activeBinId,
      };
    });
  };

  const handleSerialSubmit = (serialNumber: string) => {
    const purpose = serialPurpose;
    setSerialPurpose(null);
    if (!purpose) return;

    if (purpose.kind === 'empty-bin') {
      createEmptyBin(serialNumber);
      return;
    }

    const duplicate = session.maturingBins.find(b => b.serialNumber === serialNumber);
    if (duplicate) {
      addToast('info', `Bin #${serialNumber} is already open — switched to it`);
      setActiveBin(duplicate.id);
      leaveMode();
      return;
    }

    if (purpose.kind === 'host') {
      makeBinFromTile(purpose.tileId, serialNumber, true);
      addToast('success', `Filling bin #${serialNumber}`);
      leaveMode();
    } else {
      makeBinFromTile(purpose.tileId, serialNumber, false);
      addToast('success', `Bin #${serialNumber} going in as it is`);
    }
  };

  // ── Tile ──────────────────────────────────────────────────────────────────

  const tileRow = (tile: PickupTile) => {
    const isBin = canHostMaturing(tile);
    // In the two picking modes only wheelie bins are choosable — buckets have
    // to be tipped into something.
    const choosable = mode === 'idle' ? !!activeBin : isBin;
    const isSelected = selected.has(tile.id);

    const onTap = () => {
      if (mode === 'straight-in') return toggleSelected(tile);
      if (mode === 'pick-host') return startBuildFrom(tile);
      if (activeBin) return addToActiveBin(tile.id);
    };

    return (
      <button
        key={tile.id}
        type="button"
        disabled={!choosable}
        onClick={onTap}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${
          isSelected
            ? 'border-green-primary bg-green-50'
            : choosable
            ? 'border-gray-200 bg-white active:bg-gray-50'
            : 'border-gray-100 bg-white opacity-50 cursor-not-allowed'
        }`}
      >
        <span
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isSelected ? 'bg-green-primary text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isSelected ? <Check size={16} /> : <Package size={16} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            {/* Buckets have no serial yet — a scan system for them is coming,
                so the slot is left empty rather than filled with a stand-in. */}
            <span className="font-mono font-bold text-gray-900 truncate">
              {isBin ? (tile.serialNumber ? `#${tile.serialNumber}` : 'No serial') : ''}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-gray-400 shrink-0">
              {containerLabel(tile.collectionType)}
            </span>
          </span>
          <span className="block text-sm text-gray-600 truncate">{tile.businessName}</span>
        </span>

        <span
          className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${
            tile.averageFullness >= 100
              ? 'bg-green-100 text-green-800'
              : tile.averageFullness >= 75
              ? 'bg-lime-100 text-lime-800'
              : tile.averageFullness >= 50
              ? 'bg-amber-100 text-amber-800'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {fullnessLabel(tile)}
        </span>
      </button>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const listHeading =
    mode === 'straight-in'
      ? 'Tick the bins going in as they are'
      : mode === 'pick-host'
      ? "Tap the bin you'll fill"
      : activeBin
      ? `Tap to add to #${activeBin.serialNumber}`
      : `To sort (${tiles.length})`;

  return (
    <div className="space-y-3">
      {/* ── The bin being filled ───────────────────────────────────────── */}
      {activeBin && (
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
                <p className="font-bold text-gray-900 text-lg truncate font-mono">
                  #{activeBin.serialNumber}
                </p>
              </div>
              {/* Count only. The old "≈N L / 120 L" readout came from a volume
                  model that treats a tipped-in 120L wheelie bin as 120L of
                  maturing-bin space, so it read 660L for a bin that physically
                  holds 120L. Per-source volume is still recorded on each
                  content row for reporting. */}
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-gray-700">{binItemCount(activeBin)} in</p>
                <p className="text-xs text-gray-500">Ready {formatReadyDate(activeBin.readyDate)}</p>
              </div>
            </div>
          </div>

          <div className="p-2.5">
            <div className="space-y-1">
              {sortedBinContents(activeBin).map(content => {
                const isHost = content.pickupTileId === activeBin.hostTileId;
                return (
                  <div
                    key={content.id}
                    className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono font-semibold text-gray-800 shrink-0">
                      {content.sourceSerial ? `#${content.sourceSerial}` : ''}
                    </span>
                    <span className="text-gray-600 truncate flex-1">{content.businessName}</span>
                    <span className="text-gray-400 shrink-0">
                      {containerLabel(content.collectionType)}
                    </span>
                    {isHost ? (
                      <span className="text-[10px] uppercase tracking-wide text-green-700 font-semibold shrink-0">
                        the bin
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeContent(activeBin.id, content.id)}
                        className="p-1 -m-0.5 text-gray-400 hover:text-red-500 shrink-0"
                        aria-label={`Take ${content.businessName}'s ${containerLabel(content.collectionType)} back out`}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 mt-2.5">
              <Button variant="outline" fullWidth onClick={() => setActiveBin(null)}>
                <Check size={16} className="mr-1.5" />
                Finish this bin
              </Button>
            </div>
            <button
              type="button"
              onClick={() => scrapBin(activeBin.id)}
              className="w-full text-[11px] text-gray-400 hover:text-red-500 mt-1.5"
            >
              Scrap this bin and put everything back
            </button>
          </div>
        </div>
      )}

      {/* ── The two ways in ────────────────────────────────────────────── */}
      {!activeBin && mode === 'idle' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={tiles.length === 0}
            onClick={() => setMode('straight-in')}
            className="py-4 px-2 rounded-xl border-2 border-green-primary/50 bg-green-50/50 text-green-900 flex flex-col items-center justify-center gap-1 disabled:opacity-40"
          >
            <ArrowDownToLine size={20} />
            <span className="font-semibold text-sm">Straight in</span>
            <span className="text-[11px] text-green-700/80 text-center leading-tight">
              Full bins, nothing added
            </span>
          </button>
          <button
            type="button"
            disabled={tiles.length === 0}
            onClick={() => setMode('pick-host')}
            className="py-4 px-2 rounded-xl border-2 border-gray-300 bg-white text-gray-800 flex flex-col items-center justify-center gap-1 disabled:opacity-40"
          >
            <Layers size={20} />
            <span className="font-semibold text-sm">Build a bin</span>
            <span className="text-[11px] text-gray-500 text-center leading-tight">
              Pick one, then fill it
            </span>
          </button>
        </div>
      )}

      {/* ── Mode banners ───────────────────────────────────────────────── */}
      {mode === 'pick-host' && (
        <div className="bg-white rounded-xl border-2 border-green-primary p-3">
          <p className="text-sm font-semibold text-gray-900">Which bin are you filling?</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Tap it in the list below — whatever&apos;s in it already stays in it.
          </p>
          <div className="flex gap-2 mt-2.5">
            <Button
              variant="outline"
              fullWidth
              onClick={() => setSerialPurpose({ kind: 'empty-bin' })}
            >
              <Plus size={15} className="mr-1.5" />
              Use an empty bin
            </Button>
            <Button variant="outline" fullWidth onClick={leaveMode}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === 'straight-in' && (
        <div className="bg-white rounded-xl border-2 border-green-primary p-3">
          <p className="text-sm font-semibold text-gray-900">
            {selected.size === 0
              ? 'Which bins are going in as they are?'
              : `${selected.size} bin${selected.size === 1 ? '' : 's'} going in as ${selected.size === 1 ? 'it is' : 'they are'}`}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Each one gets its own row on the sheet, nothing tipped into it.
          </p>

          {/* Three ways to fill the tick list: scan down the row, take every
              full bin in one go, or tap them individually below. */}
          <div className="flex gap-2 mt-2.5">
            <Button fullWidth onClick={() => setScanning(true)} disabled={binCandidates.length === 0}>
              <ScanLine size={15} className="mr-1.5" />
              Scan them
            </Button>
            <Button
              variant="outline"
              fullWidth
              onClick={selectAllFull}
              disabled={fullBins.length === 0}
            >
              All {fullBins.length} full
            </Button>
          </div>

          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              fullWidth
              onClick={() => confirmStraightIn()}
              disabled={selected.size === 0}
            >
              <Check size={15} className="mr-1.5" />
              Done
            </Button>
            <Button variant="outline" fullWidth onClick={leaveMode}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── The list ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {listHeading}
          </h3>
          {activeBin && mode === 'idle' && tiles.length > 0 && (
            <span className="text-[11px] text-gray-400">Bins first, fullest at the top</span>
          )}
        </div>

        {session.pickupTiles.length === 0 ? (
          <div className="bg-white border-2 border-gray-200 rounded-xl p-4 text-center">
            <p className="text-gray-500 text-sm">Nothing collected yet</p>
          </div>
        ) : tiles.length === 0 ? (
          <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
            <Check size={22} className="text-green-primary mx-auto mb-1" />
            <p className="text-green-800 font-medium text-sm">Everything&apos;s in a bin</p>
          </div>
        ) : (
          <div className="space-y-1.5">{tiles.map(tileRow)}</div>
        )}

        {!activeBin && mode === 'idle' && tiles.length > 0 && (
          <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Pick one of the two buttons above to start sorting these.
            </p>
          </div>
        )}

        {mode !== 'idle' && (
          <p className="text-[11px] text-gray-400 text-center mt-2">
            Buckets can&apos;t be a maturing bin — they get tipped into one.
          </p>
        )}
      </div>

      {/* ── Bins finished today — tap to reopen ────────────────────────────
          Below the list, not above it. While you're filling a bin this strip
          only grows, and up top it pushed the containers you're actually
          working through further down the screen with every bin you closed. */}
      {otherBins.length > 0 && mode === 'idle' && (
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Bins done today — tap to add more
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
                <span className="font-mono font-semibold text-gray-800">#{bin.serialNumber}</span>
                <span className="text-xs text-gray-500">{binItemCount(bin)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <SerialNumberModal
        isOpen={serialPurpose !== null}
        onClose={() => setSerialPurpose(null)}
        onSubmit={handleSerialSubmit}
      />

      {/* Scanning ticks the same selection the list does, so a scanned bin
          shows green behind the camera and Done commits the lot either way. */}
      <ScanBinsModal
        isOpen={scanning}
        candidates={binCandidates}
        selectedIds={selected}
        totalSelected={selected.size}
        onHit={tile => setSelected(prev => new Set(prev).add(tile.id))}
        onClose={() => setScanning(false)}
        onDone={() => {
          setScanning(false);
          confirmStraightIn();
        }}
      />
    </div>
  );
}
