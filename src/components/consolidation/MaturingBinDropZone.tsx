import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';

interface MaturingBinDropZoneProps {
  binId: string;
  children: ReactNode;
  hasSelectedTile?: boolean;
  onBinTap?: () => void;
}

export function MaturingBinDropZone({ binId, children, hasSelectedTile, onBinTap }: MaturingBinDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `dropzone-${binId}`,
    data: { binId },
  });

  return (
    <div
      ref={setNodeRef}
      onClick={hasSelectedTile ? onBinTap : undefined}
      className={`transition-all duration-200 rounded-xl ${
        isOver
          ? 'ring-2 ring-green-primary ring-offset-2 bg-green-50'
          : hasSelectedTile
          ? 'ring-2 ring-green-primary/40 ring-offset-1 cursor-pointer'
          : ''
      }`}
    >
      {children}
    </div>
  );
}
