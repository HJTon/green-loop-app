import { useState } from 'react';
import { MapPinned, ChevronDown, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { parseLocationInput, formatOverride } from '@/utils/locationOverride';

interface LocationOverrideSectionProps {
  businessName: string;
  manualLat?: number | null;
  manualLng?: number | null;
  onSave: (lat: number | null, lng: number | null) => Promise<void> | void;
}

/**
 * Collapsible "Override location" section shown on the pickup screen. Lets the
 * driver pin a stop manually when its postal address won't geocode cleanly —
 * rural delivery, brand-new builds, landmark-only sites, etc.
 *
 * Two input shapes:
 *   1. Google Maps share link (mobile share / browser place URL / older "ll="
 *      / directions destination — see locationOverride.ts)
 *   2. Plain "lat, lng" text, e.g. "-39.0578, 174.0876"
 *
 * The override flows back through onSave (typically to the sheet via the
 * Manual Lat / Manual Lng columns). When set, it takes precedence over
 * geocoded coordinates in the route optimiser.
 */
export function LocationOverrideSection({
  manualLat,
  manualLng,
  onSave,
}: LocationOverrideSectionProps) {
  const hasOverride = manualLat != null && manualLng != null;

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(
    hasOverride ? formatOverride(manualLat!, manualLng!) : ''
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const handleSave = async () => {
    const result = parseLocationInput(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(result.value.lat, result.value.lng);
      setInput(formatOverride(result.value.lat, result.value.lng));
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn\'t save override');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave(null, null);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn\'t clear override');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <MapPinned size={16} className="text-sky-600" />
          Override location
          {hasOverride && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded-full">
              manually set
            </span>
          )}
        </span>
        <ChevronDown size={18} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-gray-600 leading-relaxed">
            Paste a Google Maps share link or type the lat/lng (e.g.{' '}
            <span className="font-mono">-39.0578, 174.0876</span>). The manual
            pin wins over the geocoded address.
          </p>

          <textarea
            value={input}
            onChange={e => {
              setInput(e.target.value);
              if (error) setError(null);
            }}
            rows={2}
            placeholder="https://maps.google.com/?q=-39.0578,174.0876  —or—  -39.0578, 174.0876"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none font-mono"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}
          {savedToast && (
            <p className="text-xs text-green-700 flex items-center gap-1">
              <Check size={12} /> Saved
            </p>
          )}

          <div className="flex gap-2">
            {hasOverride && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={saving}
                className="flex-1"
              >
                <Trash2 size={14} className="mr-1" /> Clear
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={saving || !input.trim()}
              className="flex-1"
            >
              {saving ? 'Saving…' : hasOverride ? 'Update pin' : 'Save pin'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
