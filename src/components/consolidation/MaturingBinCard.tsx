import { Package, Calendar, Trash2, X } from 'lucide-react';
import type { MaturingBin, PickupTile } from '@/types';
import { formatReadyDate, isBinReady } from '@/services/consolidationService';
import { PickupTileCard } from './PickupTileCard';

interface MaturingBinCardProps {
  bin: MaturingBin;
  onRemoveContent?: (pickupTileId: string) => void;
  isDropTarget?: boolean;
  hasSelectedTile?: boolean;
  compact?: boolean;
}

export function MaturingBinCard({ bin, onRemoveContent, isDropTarget, hasSelectedTile, compact }: MaturingBinCardProps) {
  const ready = isBinReady(bin);

  const totalItems = bin.contents.reduce((sum, c) => sum + c.binsCount, 0);

  return (
    <div
      className={`bg-white rounded-xl border-2 overflow-hidden transition-all duration-200 ${
        isDropTarget
          ? 'border-green-primary bg-green-50'
          : ready
          ? 'border-lime-accent'
          : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className={`${compact ? 'px-2 py-2' : 'px-4 py-3'} ${ready ? 'bg-lime-100' : 'bg-gray-50'} border-b border-gray-200`}>
        {compact ? (
          <div>
            <div className="flex items-center gap-1">
              <Package size={14} className={ready ? 'text-green-700' : 'text-gray-600'} />
              <span className="font-bold text-gray-900 text-sm">#{bin.serialNumber}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
              <Calendar size={11} />
              <span>{formatReadyDate(bin.readyDate)}</span>
            </div>
            {totalItems > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                <Trash2 size={11} />
                <span>{totalItems} from {bin.contents.length}</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={18} className={ready ? 'text-green-700' : 'text-gray-600'} />
                <span className="font-bold text-gray-900">Bin #{bin.serialNumber}</span>
              </div>
              <div className="flex items-center gap-1 text-sm text-gray-600">
                <Calendar size={14} />
                <span>Ready: {formatReadyDate(bin.readyDate)}</span>
              </div>
            </div>
            {totalItems > 0 && (
              <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                <Trash2 size={14} />
                <span>{totalItems} items from {bin.contents.length} pickups</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Contents */}
      <div className={`${compact ? 'p-2' : 'p-3'} min-h-[60px]`}>
        {bin.contents.length === 0 ? (
          <div className={`flex items-center justify-center h-12 text-xs border-2 border-dashed rounded-lg transition-colors ${
            hasSelectedTile
              ? 'border-green-primary text-green-700 bg-green-50'
              : 'border-gray-200 text-gray-400'
          }`}>
            {hasSelectedTile ? 'Tap to assign' : 'Empty'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {hasSelectedTile && (
              <div className="text-xs text-center text-green-700 font-medium py-1 bg-green-50 rounded-lg border border-green-200">
                Tap to add here
              </div>
            )}
            {bin.contents.map(content => {
              const tile: PickupTile = {
                id: content.pickupTileId,
                clientId: content.clientId,
                businessName: content.businessName,
                binsCollected: content.binsCount,
                collectionType: content.collectionType,
                fullness: [],
                averageFullness: content.averageFullness,
                serialNumber: '', // Not shown for contents - bin already has the serial
                isAssigned: true,
              };

              return (
                <div key={content.id} className="flex items-center gap-1">
                  <div className="flex-1 min-w-0">
                    {compact ? (
                      <div className="flex items-center gap-1 text-xs text-gray-700 py-0.5">
                        <span className="font-medium truncate">{content.businessName}</span>
                      </div>
                    ) : (
                      <PickupTileCard tile={tile} isCompact />
                    )}
                  </div>
                  {onRemoveContent && (
                    <button
                      onClick={() => onRemoveContent(content.pickupTileId)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
