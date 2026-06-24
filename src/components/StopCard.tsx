import { MapPin, Trash2, Check, SkipForward, GripVertical, Zap, Sprout, Camera, MapPinOff, RefreshCw, MapPinned } from 'lucide-react';
import { useState } from 'react';
import type { Client, RouteStop, AdHocReason } from '@/types';

const REASON_LABELS: Record<AdHocReason, string> = {
  maggots: 'Maggots',
  overflow: 'Overflowing',
  customer_request: 'Customer request',
  other: 'Other',
};

interface StopCardProps {
  stop: RouteStop;
  client: Client;
  onClick: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
  disabled?: boolean;
  // True when this stop doesn't yet have a coord - surfaces a loud "No location"
  // badge so drivers can see at a glance which stops are sitting outside the
  // optimisation. Wire `onRetryGeocode` to expose a one-tap retry next to it.
  unlocated?: boolean;
  onRetryGeocode?: () => void | Promise<void>;
}

export function StopCard({ stop, client, onClick, dragHandleProps, isDragging, disabled, unlocated, onRetryGeocode }: StopCardProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRetryGeocode || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetryGeocode();
    } finally {
      setIsRetrying(false);
    }
  };

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
        {!disabled && (
          <div
            {...dragHandleProps}
            className="flex items-center justify-center px-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
          >
            <GripVertical size={20} />
          </div>
        )}

        <button
          onClick={disabled ? undefined : onClick}
          className={`flex-1 p-4 ${disabled ? 'pl-4' : 'pl-1'} text-left ${disabled ? 'cursor-default' : 'active:bg-gray-50'} rounded-r-xl`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
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

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900 truncate">
                    {client.business_name}
                  </h3>
                  {stop.isAdHoc && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300">
                      <Zap size={10} />
                      Early
                    </span>
                  )}
                  {client.collection_type === 'soil' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300">
                      <Sprout size={10} />
                      Soil
                    </span>
                  )}
                  {client.find_media && client.find_media.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-dark border border-green-300"
                      title="Has a photo/video of how to find the bins"
                    >
                      <Camera size={10} />
                      Find help
                    </span>
                  )}
                  {client.manual_lat != null && client.manual_lng != null && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-sky-100 text-sky-800 border border-sky-300"
                      title="Pin set manually - overrides the geocoded address"
                    >
                      <MapPinned size={10} />
                      Manually set
                    </span>
                  )}
                  {unlocated && stop.status === 'pending' && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700 border border-red-300"
                      title="Could not geocode this address - stop is excluded from auto-optimisation"
                    >
                      <MapPinOff size={10} />
                      No location
                      {onRetryGeocode && (
                        <button
                          type="button"
                          onClick={handleRetry}
                          disabled={isRetrying}
                          aria-label="Retry address lookup"
                          className="ml-0.5 inline-flex items-center hover:text-red-900 disabled:opacity-50"
                        >
                          <RefreshCw size={10} className={isRetrying ? 'animate-spin' : ''} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                  <MapPin size={14} />
                  <span className="truncate">{client.address}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1 text-sm text-gray-600">
                    {client.collection_type === 'soil' ? <Sprout size={14} /> : <Trash2 size={14} />}
                    <span>
                      {client.expected_quantity}x {client.collection_type}
                    </span>
                  </div>
                  {stop.isAdHoc && stop.adHocReason && (
                    <span className="text-xs text-amber-700">
                      {REASON_LABELS[stop.adHocReason]}
                    </span>
                  )}
                </div>
              </div>
            </div>

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

          {stop.notes && (
            <p className="text-xs text-gray-500 mt-2 pl-11 italic">{stop.notes}</p>
          )}
        </button>
      </div>
    </div>
  );
}
