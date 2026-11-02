import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { StopCard } from './StopCard';
import type { Client, RouteStop } from '@/types';

interface SortableStopCardProps {
  stop: RouteStop;
  client: Client;
  onClick: () => void;
  disabled?: boolean;
  unlocated?: boolean;
  onRetryGeocode?: () => void | Promise<void>;
}

export function SortableStopCard({ stop, client, onClick, disabled, unlocated, onRetryGeocode }: SortableStopCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.client_id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <StopCard
        stop={stop}
        client={client}
        onClick={onClick}
        dragHandleProps={disabled ? undefined : { ...attributes, ...listeners }}
        isDragging={isDragging}
        disabled={disabled}
        unlocated={unlocated}
        onRetryGeocode={onRetryGeocode}
      />
    </div>
  );
}
