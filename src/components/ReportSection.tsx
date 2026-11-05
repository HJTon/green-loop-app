import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { PickupReport, ReportUrgency, ReportRecipient } from '@/types';

interface ReportSectionProps {
  report: PickupReport | null;
  onChange: (report: PickupReport | null) => void;
}

// Jermaine always receives every report. These are optional extras the driver
// can tick on a per-report basis.
const OPTIONAL_RECIPIENTS: { id: ReportRecipient; name: string }[] = [
  { id: 'sophie', name: 'Sophie' },
  { id: 'mieke', name: 'Mieke' },
  { id: 'joe', name: 'Joe' },
];

export function ReportSection({ report, onChange }: ReportSectionProps) {
  const [isExpanded, setIsExpanded] = useState(!!report?.issue);

  const updateReport = (patch: Partial<PickupReport>) => {
    const next: PickupReport = {
      issue: report?.issue || '',
      action: '',
      urgency: report?.urgency || 'normal',
      recipients: report?.recipients || [],
      ...patch,
    };
    onChange(next);
  };

  const toggleRecipient = (id: ReportRecipient) => {
    const current = report?.recipients || [];
    const next = current.includes(id)
      ? current.filter(r => r !== id)
      : [...current, id];
    updateReport({ recipients: next });
  };

  const isChecked = (id: ReportRecipient) => (report?.recipients || []).includes(id);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-orange-500" />
          <span className="font-medium text-gray-700">Report to Accounts</span>
        </div>
        {isExpanded ? (
          <ChevronUp size={20} className="text-gray-500" />
        ) : (
          <ChevronDown size={20} className="text-gray-500" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What happened and what action did you take?
            </label>
            <textarea
              value={report?.issue || ''}
              onChange={e => updateReport({ issue: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
              placeholder="Describe what happened and any action taken..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Urgency
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => updateReport({ urgency: 'normal' as ReportUrgency })}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all duration-200 ${
                  report?.urgency !== 'urgent'
                    ? 'bg-gray-200 text-gray-800'
                    : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}
              >
                Normal
              </button>
              <button
                onClick={() => updateReport({ urgency: 'urgent' as ReportUrgency })}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all duration-200 ${
                  report?.urgency === 'urgent'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}
              >
                Urgent
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Also send to
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Jermaine always receives this report. Tick anyone else who should see it.
            </p>
            <div className="space-y-2">
              {OPTIONAL_RECIPIENTS.map(({ id, name }) => (
                <label
                  key={id}
                  className="flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(id)}
                    onChange={() => toggleRecipient(id)}
                    className="w-4 h-4 rounded border-gray-300 text-green-primary focus:ring-green-primary"
                  />
                  <span className="text-sm text-gray-800">{name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
