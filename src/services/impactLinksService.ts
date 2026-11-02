import { apiFetch } from '@/utils/apiClient';
import { isProduction } from '@/services/sheetDataService';

// Each business's impact report link lives in the "Impact Reports" tab of the
// schedule sheet (written by impact-sync). The pages themselves are public on
// the Compost Monitor; the app only needs the name → link list.
//
// The list is cached in localStorage so a driver can still pull a link up
// with no signal; it refreshes in the background whenever the app is online.

export interface ImpactLink {
  business: string;
  url: string;
}

const CACHE_KEY = 'greenloop_impact_links';
const TAB = 'Impact Reports';
const COL_BUSINESS = 0; // A
const COL_LINK = 4; // E "Report link"

const norm = (s: string) => s.trim().toLowerCase();

function readCache(): ImpactLink[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ImpactLink[]) : [];
  } catch {
    return [];
  }
}

function writeCache(links: ImpactLink[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(links));
  } catch { /* storage full or blocked: the list just isn't kept offline */ }
}

let inflight: Promise<ImpactLink[]> | null = null;

/** Fetches the list from the sheet, updating the offline cache. Falls back to the cache on failure. */
export function fetchImpactLinks(): Promise<ImpactLink[]> {
  if (!isProduction()) return Promise.resolve(readCache());
  inflight ??= (async () => {
    try {
      const res = await apiFetch(`/.netlify/functions/sheets-read?tab=${encodeURIComponent(TAB)}`);
      if (!res.ok) throw new Error(`sheets-read ${res.status}`);
      const rows = ((await res.json()) as { data?: string[][] }).data ?? [];
      const links = rows
        .slice(1)
        .map((r) => ({ business: (r[COL_BUSINESS] ?? '').trim(), url: (r[COL_LINK] ?? '').trim() }))
        .filter((l) => l.business && l.url.startsWith('https://'))
        .sort((a, b) => a.business.localeCompare(b.business));
      writeCache(links);
      return links;
    } catch (e) {
      console.warn('Impact links: using cached list', e);
      return readCache();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Cached list, available synchronously (may be empty until the first fetch). */
export const cachedImpactLinks = readCache;

export function findImpactLink(links: ImpactLink[], businessName: string): string | undefined {
  const n = norm(businessName);
  return links.find((l) => norm(l.business) === n)?.url;
}
