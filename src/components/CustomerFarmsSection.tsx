import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, Tractor } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { getAllClients } from '@/services/sheetDataService';
import { getActiveFarmsWithCoords } from '@/utils/routeOptimiser';
import { farmForClient, isLockedFarm } from '@/utils/farmAssignment';

/**
 * Settings section: which farm each customer's food waste goes to. Days with
 * customers for two farms are split into one run per farm automatically.
 * Saves to the Site Info tab (col E).
 */
export function CustomerFarmsSection() {
  const { savePreferredFarm } = useApp();
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const farms = useMemo(() => getActiveFarmsWithCoords(), []);

  const clients = useMemo(
    () =>
      getAllClients()
        .filter((c, i, all) => all.findIndex(x => x.id === c.id) === i)
        .sort((a, b) => a.business_name.localeCompare(b.business_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, tick]
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clients) {
      const f = farmForClient(c);
      if (f) m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [clients]);

  const change = async (businessName: string, farmId: string) => {
    await savePreferredFarm(businessName, farmId);
    setTick(t => t + 1);
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 border-b border-gray-100 flex items-center justify-between text-left"
      >
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Tractor size={18} className="text-green-primary" /> Customer farms
        </h2>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      <div className="p-4">
        <p className="text-sm text-gray-600">
          Which farm each customer's food waste goes to. On days with customers for both farms the
          route splits into one run per farm. <Lock size={12} className="inline mb-0.5" /> Eudaimonia
          only takes its own customers (feedstock trials); anyone unassigned goes to{' '}
          {farms.find(f => !f.assigned_only)?.farm_name ?? 'the open farm'}.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          {farms.map(f => `${f.farm_name}: ${counts.get(f.id) ?? 0}`).join(' · ')}
        </p>

        {open && (
          <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
            {clients.length === 0 && (
              <li className="py-4 text-sm text-gray-400 text-center">No customers loaded yet</li>
            )}
            {clients.map(c => {
              const current = farmForClient(c) ?? '';
              return (
                <li key={c.id} className="py-2 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">
                    {isLockedFarm(current) && <Lock size={11} className="inline mb-0.5 mr-1 text-gray-400" />}
                    {c.business_name}
                  </span>
                  <select
                    value={current}
                    onChange={e => change(c.business_name, e.target.value)}
                    className="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-green-primary focus:ring-1 focus:ring-green-primary"
                    aria-label={`Farm for ${c.business_name}`}
                  >
                    {farms.map(f => (
                      <option key={f.id} value={f.id}>{f.farm_name}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
