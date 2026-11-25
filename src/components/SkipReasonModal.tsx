import { AlertTriangle, XCircle, X } from 'lucide-react';

interface SkipReasonModalProps {
  isOpen: boolean;
  businessName: string;
  // Off-sheet stops (new location / ad-hoc) have no grid row to charge against.
  showChargeOption: boolean;
  onAborted: () => void;
  onNoCharge: () => void;
  onCancel: () => void;
}

/**
 * Asks why a stop is being skipped before recording it. "Bins not out" is a
 * chargeable aborted pickup (customer forgot to put bins out); "Other" is the
 * plain free skip that's always existed.
 */
export function SkipReasonModal({
  isOpen,
  businessName,
  showChargeOption,
  onAborted,
  onNoCharge,
  onCancel,
}: SkipReasonModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Skip {businessName}?</h2>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {showChargeOption && (
            <button
              type="button"
              onClick={onAborted}
              className="w-full flex items-start gap-3 p-4 bg-amber-50 rounded-lg border-2 border-amber-200 hover:border-amber-400 transition-colors text-left"
            >
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Bins not out</p>
                <p className="text-sm text-amber-800">Aborted pickup — customer will be charged</p>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onNoCharge}
            className="w-full flex items-start gap-3 p-4 bg-gray-50 rounded-lg border-2 border-gray-200 hover:border-gray-300 transition-colors text-left"
          >
            <XCircle size={20} className="text-gray-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Other</p>
              <p className="text-sm text-gray-600">No charge</p>
            </div>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full text-center text-sm text-gray-500 hover:text-gray-700 pt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
