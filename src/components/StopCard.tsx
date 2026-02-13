import { MapPin, Trash2, Check, SkipForward, GripVertical } from 'lucide-react';
import type { Client, RouteStop } from '@/types';

interface StopCardProps {
  stop: RouteStop;
  client: Client;
  onClick: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
  disabled?: boolean;
}

export function StopCard({ stop, client, onClick, dragHandleProps, isDragging, disabled }: StopCardProps) {
  const statusStyles = {
    pending: 'border-gray-200 bg-white',
    completed: 'border-green-primary bg-green-50',
    skipped: 'border-orange-400 bg-orange-50',
  };

  const statusIcons = {
    pending: null,
    completed: <Check className="text-green-primary" size={20} />,
    skipped: <SkipForward className="text-orange-500" size={20} />,
  };

  return (
    <div
      className={`w-full rounded-xl border-2 text-left transition-all duration-200 ${statusStyles[stop.status]} ${isDragging ? 'shadow-lg scale-[1.02] opacity-90' : ''}`}
    >
      <div className="flex">
        {/* Drag Handle - hidden when disabled */}
        {!disabled && (
          <div
            {...dragHandleProps}
            className="flex items-center justify-center px-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
          >
            <GripVertical size={20} />
          </div>
        )}

        {/* Main Content - Clickable */}
        <button
          onClick={disabled ? undefined : onClick}
          className={`flex-1 p-4 ${disabled ? 'pl-4' : 'pl-1'} text-left ${disabled ? 'cursor-default' : 'active:bg-gray-50'} rounded-r-xl`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              {/* Position Badge */}
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              stop.status === 'pending'
                ? 'bg-green-primary text-white'
                : stop.status === 'completed'
                ? 'bg-green-700 text-white'
                : 'bg-orange-400 text-white'
            }`}
          >
            {stop.position}
          </div>

          {/* Business Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {client.business_name}
            </h3>
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
              <MapPin size={14} />
              <span className="truncate">{client.address}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-1 text-sm text-gray-600">
                <Trash2 size={14} />
                <span>
                  {client.expected_quantity}x {client.collection_type}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Logo and Status */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {client.logo_url && (
            <img
              src={client.logo_url}
              alt={`${client.business_name} logo`}
              className="w-12 h-12 object-contain rounded"
            />
          )}
          {statusIcons[stop.status]}
        </div>
      </div>

          {/* Notes */}
          {stop.notes && (
            <p className="text-xs text-gray-500 mt-2 pl-11 italic">{stop.notes}</p>
          )}
        </button>
      </div>
    </div>
  );
}
