import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Download } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useApp } from '@/contexts/AppContext';

// On-phone recovery / diagnostic screen.
//
// Chrome on Android has no built-in DevTools UI and blocks `javascript:` URLs
// from the address bar, so on-phone extraction of localStorage would otherwise
// require plugging into a computer. This route exposes the relevant keys as
// collapsible sections with count / copy-JSON / preview textarea, plus a
// full-storage JSON download at the top. No auth gate — the app is
// single-user on a personal phone. Everything shown here is client-side
// localStorage that the driver already owns.
//
// EXPOSED KEYS (logged to console on mount for code review):
//   greenloop_pickups
//   greenloop_pending_writes
//   greenloop_pending_notes
//   greenloop_pending_emails
//   greenloop_pending_maturing_bins
//   greenloop_consolidation
//   greenloop_route_state
const EXPOSED_KEYS: readonly string[] = [
  'greenloop_pickups',
  'greenloop_pending_writes',
  'greenloop_pending_notes',
  'greenloop_pending_emails',
  'greenloop_pending_maturing_bins',
  'greenloop_consolidation',
  'greenloop_route_state',
] as const;

function readKey(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function entryCount(value: unknown): number {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value as object).length;
  return 1;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to textarea trick
  }
  // Fallback: hidden textarea + execCommand for older mobile browsers.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Filter greenloop_pickups by an inclusive date range (YYYY-MM-DD). Empty
// bounds mean "no lower / upper limit". Non-array payloads pass through
// untouched — the filter only applies when the pickups key contains an array.
function filterPickupsByDate(
  value: unknown,
  from: string,
  to: string
): unknown {
  if (!Array.isArray(value)) return value;
  if (!from && !to) return value;
  return value.filter(item => {
    const d = (item && typeof item === 'object' && 'date' in item)
      ? String((item as { date: unknown }).date ?? '')
      : '';
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

interface SectionProps {
  storageKey: string;
}

function StorageSection({ storageKey }: SectionProps) {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const raw = readKey(storageKey);
  const isPickups = storageKey === 'greenloop_pickups';
  const filtered = isPickups ? filterPickupsByDate(raw, dateFrom, dateTo) : raw;
  const count = entryCount(filtered);
  const json = JSON.stringify(filtered, null, 2);

  const handleCopy = async () => {
    const ok = await copyText(json);
    setCopyState(ok ? 'ok' : 'fail');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <section className="bg-white border border-gray-200 rounded-lg mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="font-mono text-sm text-gray-900">{storageKey}</span>
        <span className="text-xs text-gray-500">
          {count} {count === 1 ? 'entry' : 'entries'} · {open ? 'hide' : 'show'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-gray-100">
          {isPickups && (
            <div className="flex flex-wrap items-end gap-2 mt-2 mb-2">
              <label className="text-xs text-gray-600 flex flex-col">
                <span>Date from</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="mt-0.5 border border-gray-300 rounded px-1 py-0.5 text-xs"
                />
              </label>
              <label className="text-xs text-gray-600 flex flex-col">
                <span>Date to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="mt-0.5 border border-gray-300 rounded px-1 py-0.5 text-xs"
                />
              </label>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-xs underline text-gray-600"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2 mb-2">
            <Button size="sm" onClick={handleCopy}>
              <Copy size={14} className="mr-1" />
              Copy JSON
            </Button>
            {copyState === 'ok' && (
              <span className="text-xs text-green-primary">Copied to clipboard</span>
            )}
            {copyState === 'fail' && (
              <span className="text-xs text-red-600">Copy failed — select the text below and copy manually</span>
            )}
          </div>

          <textarea
            readOnly
            value={json}
            className="w-full h-40 font-mono text-xs border border-gray-200 rounded p-2 bg-gray-50"
            onFocus={e => e.currentTarget.select()}
          />
        </div>
      )}
    </section>
  );
}

export function DebugExportPage() {
  const navigate = useNavigate();
  const { collector } = useApp();

  // Log to console what this screen exposes so it's obvious in code review
  // and to any dev poking at the page.
  useMemo(() => {
    console.info(
      '[DebugExportPage] on-phone recovery screen exposing localStorage keys:',
      EXPOSED_KEYS,
      collector ? `(logged in as ${collector.name})` : '(no collector logged in)'
    );
    // Only re-log if the collector identity changes.
  }, [collector]);

  const handleDownloadAll = () => {
    const snapshot: Record<string, unknown> = {};
    for (const key of EXPOSED_KEYS) {
      snapshot[key] = readKey(key);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`greenloop-storage-${timestamp}.json`, {
      exportedAt: new Date().toISOString(),
      collector: collector ? { id: collector.id, name: collector.name } : null,
      storage: snapshot,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Recovery / Export" showBack />

      <main className="p-3">
        <section className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            On-phone data recovery
          </h2>
          <p className="text-xs text-gray-600 mb-2">
            Every key below is stored on this phone only. Copy JSON opens it in
            the textarea &mdash; paste into email, notes, or a doc. Use the
            download button for a full snapshot as a single file.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleDownloadAll}>
              <Download size={14} className="mr-1" />
              Download all as JSON file
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/route')}>
              <ArrowLeft size={14} className="mr-1" />
              Back to route
            </Button>
          </div>
        </section>

        {EXPOSED_KEYS.map(key => (
          <StorageSection key={key} storageKey={key} />
        ))}

        <p className="text-xs text-gray-500 mt-4 text-center">
          This screen is a diagnostic tool. No data is sent anywhere &mdash; everything happens on your phone.
        </p>
      </main>
    </div>
  );
}
