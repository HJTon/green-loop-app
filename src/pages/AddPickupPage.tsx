import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Zap, AlertCircle, Check, Plus, ArrowLeft, Package, ShoppingBag, Sprout } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useApp } from '@/contexts/AppContext';
import type { AdHocReason, Client, CollectionType } from '@/types';

const COLLECTION_TYPE_OPTIONS: { value: CollectionType; label: string; icon: typeof Package }[] = [
  { value: 'bins', label: 'Bins', icon: Package },
  { value: 'buckets', label: 'Buckets', icon: ShoppingBag },
  { value: 'soil', label: 'Soil', icon: Sprout },
];

const REASONS: { value: AdHocReason; label: string; description: string }[] = [
  { value: 'maggots', label: 'Maggots / fly issue', description: 'Customer reported maggot or fly problem' },
  { value: 'overflow', label: 'Overflowing', description: 'Bin is full and overflowing' },
  { value: 'customer_request', label: 'Customer request', description: 'Customer rang and asked for an extra pickup' },
  { value: 'other', label: 'Other', description: 'Anything else' },
];

export function AddPickupPage() {
  const navigate = useNavigate();
  const {
    collector,
    route,
    getAllClientsForPicker,
    addAdHocStop,
    addNewLocationStop,
    addToast,
  } = useApp();

  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [query, setQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [reason, setReason] = useState<AdHocReason>('maggots');

  // New-location form
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newType, setNewType] = useState<CollectionType>('bins');
  const [newQty, setNewQty] = useState(1);

  // Redirect if not authenticated
  useEffect(() => {
    if (!collector) navigate('/');
  }, [collector, navigate]);

  // Pull every client and exclude the ones already on today's route
  const allClients = useMemo(() => getAllClientsForPicker(), [getAllClientsForPicker]);
  const onRouteIds = useMemo(
    () => new Set(route?.stops.map(s => s.client_id) ?? []),
    [route]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allClients
      .filter(c => !onRouteIds.has(c.id))
      .filter(c =>
        c.business_name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [query, allClients, onRouteIds]);

  const handleAdd = () => {
    if (!selectedClient) return;
    const ok = addAdHocStop(selectedClient.id, reason);
    if (ok) {
      addToast('success', `${selectedClient.business_name} added to today's route`);
      navigate('/route');
    } else {
      addToast('error', `Couldn't add ${selectedClient.business_name} - already on route?`);
    }
  };

  const canSubmitNew = newName.trim().length > 0 && newQty >= 1;

  const handleAddNew = () => {
    if (!canSubmitNew) return;
    addNewLocationStop({
      businessName: newName.trim(),
      address: newAddress.trim(),
      collectionType: newType,
      expectedQuantity: newQty,
      reason,
    });
    addToast('success', `${newName.trim()} added to today's route`);
    navigate('/route');
  };

  if (!collector) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <Header title={mode === 'new' ? 'New location' : 'Add early pickup'} showBack />

      <div className="px-4 py-3 space-y-3">
        {/* Compact help note */}
        <div className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertCircle className="shrink-0" size={13} />
          <span>
            {mode === 'new'
              ? 'New one-off location — logged to Pickup Notes for accounts to follow up.'
              : 'Extra pickup — customer is still billed for their regular pickup.'}
          </span>
        </div>

        {mode === 'search' && (
          <>
            {/* Step 1: Search */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Find the customer
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedClient(null);
                  }}
                  placeholder="Search by business name or address"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-gray-200 focus:border-green-primary focus:outline-none text-base"
                  autoFocus
                />
              </div>

              {/* Results */}
              {query.trim() && (
                <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
                  {matches.length === 0 && (
                    <p className="text-sm text-gray-500 italic px-1 py-3">
                      No customers found. Try a shorter search.
                    </p>
                  )}
                  {matches.map(client => {
                    const isSelected = selectedClient?.id === client.id;
                    return (
                      <button
                        key={client.id}
                        onClick={() => setSelectedClient(client)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-green-primary bg-green-50'
                            : 'border-gray-200 bg-white hover:border-green-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{client.business_name}</p>
                            <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                              <MapPin size={13} />
                              <span className="truncate">{client.address || 'No address'}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              {client.expected_quantity}x {client.collection_type} · {client.collection_frequency}
                            </p>
                          </div>
                          {isSelected && <Check className="text-green-primary shrink-0" size={20} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Can't find them? Add a brand-new location */}
            {!selectedClient && (
              <button
                onClick={() => setMode('new')}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-gray-300 text-green-primary hover:border-green-primary hover:bg-green-50 font-medium transition-colors"
              >
                <Plus size={18} />
                Can't find them? Add a new location
              </button>
            )}

            {/* Step 2: Reason */}
            {selectedClient && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Why is this an early pickup?
                </label>
                <div className="space-y-2">
                  {REASONS.map(r => {
                    const isSelected = reason === r.value;
                    return (
                      <button
                        key={r.value}
                        onClick={() => setReason(r.value)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-green-primary bg-green-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isSelected ? (
                            <div className="w-5 h-5 rounded-full bg-green-primary flex items-center justify-center shrink-0">
                              <Check size={14} className="text-white" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0" />
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{r.label}</p>
                            <p className="text-xs text-gray-500">{r.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'new' && (
          <div className="space-y-4">
            <button
              onClick={() => setMode('search')}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-green-primary"
            >
              <ArrowLeft size={16} />
              Back to search
            </button>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Business / location name
              </label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Riverside Café"
                className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-green-primary focus:outline-none text-base"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Address
              </label>
              <input
                type="text"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
                placeholder="Street address"
                className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-green-primary focus:outline-none text-base"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Container type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {COLLECTION_TYPE_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  const isSelected = newType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setNewType(opt.value)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                        isSelected ? 'border-green-primary bg-green-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <Icon size={20} className={isSelected ? 'text-green-primary' : 'text-gray-400'} />
                      <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                How many?
              </label>
              <div className="flex items-center gap-2 bg-white rounded-xl border-2 border-gray-200 p-1 w-fit">
                <button
                  onClick={() => setNewQty(q => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
                  disabled={newQty <= 1}
                >
                  −
                </button>
                <span className="w-12 text-center text-xl font-bold">{newQty}</span>
                <button
                  onClick={() => setNewQty(q => Math.min(20, q + 1))}
                  className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
                  disabled={newQty >= 20}
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Why this pickup?
              </label>
              <div className="space-y-2">
                {REASONS.map(r => {
                  const isSelected = reason === r.value;
                  return (
                    <button
                      key={r.value}
                      onClick={() => setReason(r.value)}
                      className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                        isSelected ? 'border-green-primary bg-green-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-green-primary flex items-center justify-center shrink-0">
                            <Check size={14} className="text-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0" />
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{r.label}</p>
                          <p className="text-xs text-gray-500">{r.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom action */}
      {mode === 'search' && selectedClient && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <Button onClick={handleAdd} className="w-full">
            <Zap size={18} className="mr-2" />
            Add {selectedClient.business_name} to route
          </Button>
        </div>
      )}

      {mode === 'new' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <Button onClick={handleAddNew} className="w-full" disabled={!canSubmitNew}>
            <Plus size={18} className="mr-2" />
            Add new location to route
          </Button>
        </div>
      )}
    </div>
  );
}
