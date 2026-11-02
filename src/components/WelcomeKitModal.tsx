import { useState } from 'react';
import { Gift, Check } from 'lucide-react';
import { Button } from '@/components/Button';

interface WelcomeKitModalProps {
  isOpen: boolean;
  businessName: string;
  items: string[];
  onConfirm: () => void;
  onLater: () => void;
}

/**
 * First-visit checklist: reminds the collector to hand over the welcome kit
 * (posters, stickers, flyers, box of Zing) to a brand-new business. The
 * "handed over" button only enables once every item is ticked.
 */
export function WelcomeKitModal({ isOpen, businessName, items, onConfirm, onLater }: WelcomeKitModalProps) {
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => false));

  if (!isOpen) return null;

  const toggle = (index: number) => {
    setChecked(prev => prev.map((c, i) => (i === index ? !c : c)));
  };

  const allChecked = items.length > 0 && checked.every(Boolean);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-xl">
        <div className="px-4 py-3 border-b border-gray-200 bg-green-50">
          <div className="flex items-center gap-2 text-green-primary">
            <Gift size={20} />
            <h2 className="text-lg font-semibold">First visit — welcome kit</h2>
          </div>
        </div>

        <div className="p-4">
          <p className="text-sm text-gray-700 mb-3">
            This is the first collection for{' '}
            <span className="font-semibold text-gray-900">{businessName}</span>. Hand over their
            welcome kit and tick each item:
          </p>

          <ul className="space-y-2 mb-4">
            {items.map((item, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    checked[index]
                      ? 'border-green-primary bg-green-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${
                      checked[index]
                        ? 'border-green-primary bg-green-primary text-white'
                        : 'border-gray-300'
                    }`}
                  >
                    {checked[index] && <Check size={16} />}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      checked[index] ? 'text-green-800 line-through' : 'text-gray-800'
                    }`}
                  >
                    {item}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onLater} fullWidth>
              Remind me later
            </Button>
            <Button onClick={onConfirm} disabled={!allChecked} fullWidth>
              All handed over
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
