import { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';
import { cachedImpactLinks, fetchImpactLinks, findImpactLink } from '@/services/impactLinksService';

/** Small "Impact report" link shown under a business name. Renders nothing if the business has no report. */
export function ImpactReportLink({ businessName }: { businessName: string }) {
  const [url, setUrl] = useState(() => findImpactLink(cachedImpactLinks(), businessName));

  useEffect(() => {
    let live = true;
    fetchImpactLinks().then((links) => { if (live) setUrl(findImpactLink(links, businessName)); });
    return () => { live = false; };
  }, [businessName]);

  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 mt-1 text-sm font-medium text-green-700 underline underline-offset-2"
    >
      <Leaf size={14} /> Impact report
    </a>
  );
}
