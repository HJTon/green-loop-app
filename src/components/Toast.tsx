import { useEffect } from 'react';
import { CheckCircle, AlertCircle, X, RefreshCw } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    // Auto-dismiss after 5 seconds (unless it has an action)
    if (!toast.action) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.action, onDismiss]);

  const bgColor = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
  }[toast.type];

  const Icon = {
    success: CheckCircle,
    error: AlertCircle,
    info: RefreshCw,
  }[toast.type];

  return (
    <div
      className={`${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up`}
    >
      <Icon size={20} className={toast.type === 'info' ? 'animate-spin' : ''} />
      <span className="flex-1 text-sm">{toast.message}</span>
      {toast.action && (
        <button
          onClick={toast.action.onClick}
          className="text-sm font-medium underline hover:no-underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-1 hover:bg-white/20 rounded"
      >
        <X size={16} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
