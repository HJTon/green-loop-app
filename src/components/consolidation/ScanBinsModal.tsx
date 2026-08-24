import { useState } from 'react';
import { X, Check, Loader2, Keyboard, Camera, AlertCircle } from 'lucide-react';
import { Button } from '@/components/Button';
import { CameraCapture } from './CameraCapture';
import { recognizeSerialNumber, formatSerialNumber } from '@/services/ocrService';
import { findTileBySerial, fullnessLabel } from '@/services/consolidationService';
import type { PickupTile } from '@/types';

interface ScanBinsModalProps {
  isOpen: boolean;
  /** Bins still to be sorted — the only things a scan can match. */
  candidates: PickupTile[];
  /** Tile ids already ticked, so a re-scan says "already got that one". */
  selectedIds: Set<string>;
  /**
   * Everything Done will send — scans plus anything ticked in the list before
   * the camera opened. The header counts this session's scans, but the button
   * has to name what actually happens when you press it.
   */
  totalSelected: number;
  onHit: (tile: PickupTile) => void;
  onClose: () => void;
  /** Commit what's been scanned. Count is passed for the button label. */
  onDone: () => void;
}

type Outcome =
  | { kind: 'ready' }
  | { kind: 'reading' }
  | { kind: 'hit'; tile: PickupTile }
  | { kind: 'dupe'; tile: PickupTile }
  | { kind: 'miss'; serial: string }
  | { kind: 'unreadable' };

/**
 * Straight-to-maturation, done standing in front of the bins.
 *
 * The camera stays open and you work down the row: shoot a label, it goes
 * green and the count ticks up, shoot the next. Nothing is committed until
 * Done, so a misread can be undone by walking back out to the list.
 *
 * A scan can only ever match a bin already on today's list — matching is
 * exact once case, punctuation and leading zeros are stripped
 * (`normaliseSerial`). Anything else is reported as a miss rather than
 * guessed at: putting one business's waste under another's name on the Bin
 * Tracker is the one mistake nobody can unpick afterwards.
 *
 * "Type it instead" is there for a sticker too scuffed to read — and it's the
 * only way to exercise this screen in the sandbox, where the serials are
 * invented and no real label will ever match.
 */
export function ScanBinsModal({
  isOpen,
  candidates,
  selectedIds,
  totalSelected,
  onHit,
  onClose,
  onDone,
}: ScanBinsModalProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'ready' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  if (!isOpen) return null;

  const close = () => {
    setOutcome({ kind: 'ready' });
    setTyping(false);
    setTyped('');
    setScannedIds([]);
    onClose();
  };

  const done = () => {
    setOutcome({ kind: 'ready' });
    setTyping(false);
    setTyped('');
    setScannedIds([]);
    onDone();
  };

  const handleSerial = (raw: string) => {
    const serial = formatSerialNumber(raw);
    const tile = findTileBySerial(candidates, serial);

    if (!tile) {
      setOutcome({ kind: 'miss', serial });
      return;
    }
    if (selectedIds.has(tile.id)) {
      setOutcome({ kind: 'dupe', tile });
      return;
    }

    onHit(tile);
    setScannedIds(prev => [...prev, tile.id]);
    setOutcome({ kind: 'hit', tile });
  };

  const handleCapture = async (imageData: string) => {
    setOutcome({ kind: 'reading' });
    try {
      const result = await recognizeSerialNumber(imageData);
      if (!result.suggestedSerial) {
        setOutcome({ kind: 'unreadable' });
        return;
      }
      handleSerial(result.suggestedSerial);
    } catch (error) {
      console.error('Scan failed:', error);
      setOutcome({ kind: 'unreadable' });
    }
  };

  const submitTyped = () => {
    if (!typed.trim()) return;
    handleSerial(typed);
    setTyped('');
  };

  const count = scannedIds.length;

  const banner = () => {
    switch (outcome.kind) {
      case 'reading':
        return (
          <div className="bg-black/70 text-white rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
            <Loader2 size={15} className="animate-spin shrink-0" />
            Reading the number...
          </div>
        );
      case 'hit':
        return (
          <div className="bg-green-primary text-white rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
            <Check size={16} className="shrink-0" />
            <span className="font-mono font-bold">#{outcome.tile.serialNumber}</span>
            <span className="truncate">{outcome.tile.businessName}</span>
          </div>
        );
      case 'dupe':
        return (
          <div className="bg-amber-500 text-white rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            <span className="font-mono font-bold">#{outcome.tile.serialNumber}</span>
            <span>is already going in</span>
          </div>
        );
      case 'miss':
        return (
          <div className="bg-red-500 text-white rounded-lg px-3 py-2 text-sm">
            <span className="font-mono font-bold">#{outcome.serial}</span> isn&apos;t a bin
            waiting to be sorted
          </div>
        );
      case 'unreadable':
        return (
          <div className="bg-red-500 text-white rounded-lg px-3 py-2 text-sm">
            Couldn&apos;t read that one — try again, or type it
          </div>
        );
      default:
        return (
          <div className="bg-black/60 text-white rounded-lg px-3 py-2 text-sm">
            {count === 0
              ? 'Scan each bin going straight to maturation'
              : `${count} scanned — keep going, or tap Done`}
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl overflow-hidden shadow-xl max-h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Straight to maturation</h2>
            <p className="text-xs text-gray-500">
              {count === 0 ? 'Nothing scanned yet' : `${count} bin${count === 1 ? '' : 's'} scanned`}
            </p>
          </div>
          <button onClick={close} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-3 overflow-y-auto">
          {typing ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Serial number on the bin
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={typed}
                onChange={e => setTyped(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitTyped();
                }}
                placeholder="e.g. 4102747"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-lg focus:outline-none focus:ring-2 focus:ring-green-primary"
              />
              <div className="min-h-[2.25rem]">{banner()}</div>
              <div className="flex gap-2">
                <Button fullWidth onClick={submitTyped} disabled={!typed.trim()}>
                  Add this one
                </Button>
                <Button variant="outline" fullWidth onClick={() => setTyping(false)}>
                  <Camera size={15} className="mr-1.5" />
                  Camera
                </Button>
              </div>
            </div>
          ) : (
            <>
              <CameraCapture
                continuous
                busy={outcome.kind === 'reading'}
                overlay={banner()}
                onCapture={handleCapture}
                onCancel={close}
              />
              <button
                type="button"
                onClick={() => {
                  setTyping(true);
                  setOutcome({ kind: 'ready' });
                }}
                className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-green-primary flex items-center justify-center gap-1.5"
              >
                <Keyboard size={15} />
                Can&apos;t read it? Type it instead
              </button>
            </>
          )}

          {/* What's gone in so far, newest first, so you can see the last one
              landed without leaving the camera. */}
          {count > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Scanned
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {[...scannedIds].reverse().map(id => {
                  const tile = candidates.find(t => t.id === id);
                  if (!tile) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 bg-green-50 rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      <Check size={13} className="text-green-primary shrink-0" />
                      <span className="font-mono font-semibold text-gray-800">
                        #{tile.serialNumber}
                      </span>
                      <span className="text-gray-600 truncate flex-1">{tile.businessName}</span>
                      <span className="text-gray-400 shrink-0">{fullnessLabel(tile)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 shrink-0">
          <Button fullWidth size="lg" onClick={done} disabled={totalSelected === 0}>
            <Check size={17} className="mr-1.5" />
            {totalSelected === 0
              ? 'Done'
              : `Send ${totalSelected} bin${totalSelected === 1 ? '' : 's'} to maturation`}
          </Button>
          {totalSelected > count && (
            <p className="text-[11px] text-gray-500 text-center mt-1.5">
              Includes {totalSelected - count} already ticked on the list
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
