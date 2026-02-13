import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { PickupTileCard } from './PickupTileCard';
import type { PickupTile } from '@/types';

interface DraggablePickupTileProps {
  tile: PickupTile;
}

export function DraggablePickupTile({ tile }: DraggablePickupTileProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: tile.id,
    data: { tile },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch">
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center justify-center px-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none bg-gray-50 rounded-l-lg border-2 border-r-0 border-gray-200"
      >
        <GripVertical size={18} />
      </div>

      {/* Tile Content */}
      <div className="flex-1">
        <PickupTileCard tile={tile} isDragging={isDragging} />
      </div>
    </div>
  );
}
