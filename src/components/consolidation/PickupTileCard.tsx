import { Trash2 } from 'lucide-react';
import type { PickupTile } from '@/types';

interface PickupTileCardProps {
  tile: PickupTile;
  isDragging?: boolean;
  isCompact?: boolean;
  isSelected?: boolean;
}

export function PickupTileCard({ tile, isDragging, isCompact, isSelected }: PickupTileCardProps) {
  const getFullnessColor = (percent: number) => {
    if (percent >= 75) return 'bg-green-500';
    if (percent >= 50) return 'bg-lime-500';
    if (percent >= 25) return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  const getFullnessLabel = (percent: number) => {
    if (percent >= 100) return 'Full';
    if (percent >= 75) return '3/4';
    if (percent >= 50) return '1/2';
    if (percent >= 25) return '1/4';
    return 'Empty';
  };

  const unitLabel = tile.collectionType === 'buckets' ? 'bucket' : 'bin';

  if (isCompact) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-700 py-1">
        <span className="font-medium truncate">{tile.businessName}</span>
        <span className="text-gray-400">
          (1 {unitLabel}, {getFullnessLabel(tile.averageFullness)})
        </span>
        {tile.serialNumber && (
          <span className="text-xs font-mono bg-gray-100 px-1 rounded">
            #{tile.serialNumber}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-lg border-2 p-3 transition-all duration-200 cursor-pointer ${
        isDragging
          ? 'shadow-lg scale-[1.02] border-green-primary'
          : isSelected
          ? 'border-green-primary bg-green-50 shadow-sm'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Fullness indicator */}
          <div
            className={`w-10 h-10 rounded-lg ${getFullnessColor(tile.averageFullness)} flex items-center justify-center text-white text-xs font-bold shrink-0`}
          >
            {getFullnessLabel(tile.averageFullness)}
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-gray-900 truncate">{tile.businessName}</h4>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Trash2 size={14} />
                <span>1 {unitLabel}</span>
              </div>
              {tile.serialNumber && (
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  #{tile.serialNumber}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
