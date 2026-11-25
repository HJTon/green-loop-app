import { useState } from 'react';
import { Navigation2, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/Button';

interface ApproachSectionProps {
  approachFrom?: string;
  collectionType?: string;
  onSave: (approachFrom: string) => Promise<void> | void;
}

export function ApproachSection({ approachFrom = '', collectionType, onSave }: ApproachSectionProps) {
  const [open, setOpen] = useState(!!approachFrom);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(approachFrom);
  const [saving, setSaving] = useState(false);

  const isBuckets = collectionType === 'buckets';
  const hasNote = approachFrom.trim().length > 0;

  const startEditing = () => {
    setDraft(approachFrom);
    setEditing(true);
    setOpen(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border-2 rounded-lg overflow-hidden ${hasNote ? (isBuckets ? 'border-indigo-300 bg-indigo-50' : 'border-sky-200 bg-sky-50') : 'border-gray-200'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 transition-colors ${
          hasNote
            ? isBuckets
              ? 'bg-indigo-100 hover:bg-indigo-200'
              : 'bg-sky-100 hover:bg-sky-200'
            : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <Navigation2 size={16} className={hasNote ? (isBuckets ? 'text-indigo-600' : 'text-sky-600') : 'text-gray-500'} />
          Approach / entry side
          {isBuckets && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded-full">
              Buckets
            </span>
          )}
          {hasNote && !editing && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-sky-200 text-sky-800 px-1.5 py-0.5 rounded-full">
              Note set
            </span>
          )}
        </span>
        <ChevronDown size={18} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="p-3 space-y-2">
          {!editing ? (
            <>
              {hasNote ? (
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{approachFrom}</p>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  No approach note yet.{isBuckets ? ' Bucket stops benefit most from this.' : ''}
                </p>
              )}
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 text-sm text-sky-700 hover:text-sky-900 font-medium"
              >
                <Pencil size={14} />
                {hasNote ? 'Update' : 'Add approach note'}
              </button>
            </>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={3}
                placeholder="e.g. Enter from Devon St heading west, stop outside #42 on the left."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={cancelEditing} disabled={saving} className="flex-1">
                  <X size={14} className="mr-1" />Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? 'Saving…' : <><Check size={14} className="mr-1" />Save</>}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
