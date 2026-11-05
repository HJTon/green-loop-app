import { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';
import { cachedImpactLinks, fetchImpactLinks, findImpactLink, type ImpactLink } from '@/services/impactLinksService';

/** Small "Impact report" link shown under a business name. Renders nothing if the business has no report. */
export function ImpactReportLink({ businessName }: { businessName: string }) {
  // Hold the whole list and look the business up on every render. PickupPage stays mounted
  // from one stop to the next, so storing the resolved URL would keep showing the previous
  // stop's report until the (possibly slow, out-in-the-van) refresh came back.
  const [links, setLinks] = useState<ImpactLink[]>(cachedImpactLinks);

  useEffect(() => {
    let live = true;
    fetchImpactLinks().then((l) => { if (live) setLinks(l); });
    return () => { live = false; };
  }, []);

  const url = findImpactLink(links, businessName);
  if (!url) return null;
  return (
    <a
      key={url}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 mt-1 text-sm font-medium text-green-700 underline underline-offset-2"
    >
      <Leaf size={14} /> Impact report
    </a>
  );
}
