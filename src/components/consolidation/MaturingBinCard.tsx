import { Package, Calendar, Trash2, X } from 'lucide-react';
import type { MaturingBin, PickupTile } from '@/types';
import { formatReadyDate, isBinReady } from '@/services/consolidationService';
import { PickupTileCard } from './PickupTileCard';

interface MaturingBinCardProps {
  bin: MaturingBin;
  onRemoveContent?: (pickupTileId: string) => void;
  isDropTarget?: boolean;
}

export function MaturingBinCard({ bin, onRemoveContent, isDropTarget }: MaturingBinCardProps) {
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
      <div className={`px-4 py-3 ${ready ? 'bg-lime-100' : 'bg-gray-50'} border-b border-gray-200`}>
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
      </div>

      {/* Contents */}
      <div className="p-3 min-h-[80px]">
        {bin.contents.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
            Drag pickups here
          </div>
        ) : (
          <div className="space-y-2">
            {bin.contents.map(content => {
              const tile: PickupTile = {
                id: content.pickupTileId,
                clientId: content.clientId,
                businessName: content.businessName,
                binsCollected: content.binsCount,
                collectionType: content.collectionType,
                fullness: [],
                averageFullness: content.averageFullness,
                isAssigned: true,
              };

              return (
                <div key={content.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <PickupTileCard tile={tile} isCompact />
                  </div>
                  {onRemoveContent && (
                    <button
                      onClick={() => onRemoveContent(content.pickupTileId)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={16} />
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
