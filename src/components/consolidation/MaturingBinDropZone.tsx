import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';

interface MaturingBinDropZoneProps {
  binId: string;
  children: ReactNode;
}

export function MaturingBinDropZone({ binId, children }: MaturingBinDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `dropzone-${binId}`,
    data: { binId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`transition-all duration-200 rounded-xl ${
        isOver ? 'ring-2 ring-green-primary ring-offset-2 bg-green-50' : ''
      }`}
    >
      {children}
    </div>
  );
}
