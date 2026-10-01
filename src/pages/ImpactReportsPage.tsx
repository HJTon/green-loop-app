import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, Search, Share2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { useApp } from '@/contexts/AppContext';
import { cachedImpactLinks, fetchImpactLinks, type ImpactLink } from '@/services/impactLinksService';

// Every business's impact report, so anyone on the team can open one or send
// the link to a customer. Links come from the "Impact Reports" sheet tab.
export function ImpactReportsPage() {
  const navigate = useNavigate();
  const { collector } = useApp();
  const [links, setLinks] = useState<ImpactLink[]>(cachedImpactLinks);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!collector) navigate('/');
  }, [collector, navigate]);

  useEffect(() => {
    fetchImpactLinks().then((l) => { setLinks(l); setLoading(false); });
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? links.filter((l) => l.business.toLowerCase().includes(q)) : links;
  }, [links, query]);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share(l: ImpactLink) {
    try {
      await navigator.share({ title: `${l.business} – Green Loop impact report`, url: l.url });
    } catch { /* user cancelled */ }
  }

  async function copy(l: ImpactLink) {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopied(l.url);
      setTimeout(() => setCopied((c) => (c === l.url ? null : c)), 2000);
    } catch { /* clipboard blocked: the Open link still works */ }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Impact reports" showBack />
      <div className="p-4 space-y-3 max-w-lg mx-auto">
        <p className="text-sm text-gray-600">
          Each business&apos;s food waste diverted and emissions avoided, with a PDF they can download.
          Open one here, or share the link with the business.
        </p>
        <label className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-3 py-2">
          <Search size={16} className="text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a business"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </label>

        {loading && links.length === 0 ? (
          <div className="flex justify-center py-10 text-green-700"><Loader2 className="animate-spin" /></div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            {links.length === 0 ? 'No reports available. Check your connection and try again.' : 'No business matches that.'}
          </p>
        ) : (
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {shown.map((l) => (
              <li key={l.url} className="flex items-center gap-2 px-3 py-2.5">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 flex items-center gap-2 text-gray-900">
                  <span className="truncate font-medium">{l.business}</span>
                  <ExternalLink size={14} className="text-gray-400 shrink-0" />
                </a>
                {canShare ? (
                  <button onClick={() => share(l)} aria-label={`Share ${l.business} report`} className="p-2 rounded-lg text-green-700 hover:bg-green-50">
                    <Share2 size={18} />
                  </button>
                ) : (
                  <button onClick={() => copy(l)} aria-label={`Copy ${l.business} report link`} className="p-2 rounded-lg text-green-700 hover:bg-green-50">
                    {copied === l.url ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
