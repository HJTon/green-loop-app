import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Trash2, Plus, Minus, Info, Check, Phone, User, Sprout, Gift } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { FullnessSelector } from '@/components/FullnessSelector';
import { PhotoSection } from '@/components/PhotoSection';
import { FindBinsSection } from '@/components/FindBinsSection';
import { ApproachSection } from '@/components/ApproachSection';
import { LocationOverrideSection } from '@/components/LocationOverrideSection';
import { ReportSection } from '@/components/ReportSection';
import { SerialNumberModal } from '@/components/consolidation/SerialNumberModal';
import { WelcomeKitModal } from '@/components/WelcomeKitModal';
import { SkipReasonModal } from '@/components/SkipReasonModal';
import { useApp } from '@/contexts/AppContext';
import {
  generateId,
  getCurrentDate,
  getCurrentTime,
  getPickupByClientAndDate,
  getWelcomeKitItems,
  isKitDelivered,
  markKitDelivered,
} from '@/utils/storage';
import type { BinFullness, PickupReport, PickupRecord, AdHocReason } from '@/types';

const NEW_LOCATION_REASON_LABELS: Record<AdHocReason, string> = {
  maggots: 'Maggots / fly issue',
  overflow: 'Overflowing',
  customer_request: 'Customer request',
  other: 'Other',
};

export function PickupPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const {
    collector,
    route,
    addPickup,
    updatePickup,
    updateStopStatus,
    pickups,
    getClientById,
    recordBinCount,
    recordAbortedPickup,
    isReadOnlyView,
    queueNoteWrite,
    queueEmailSend,
    saveSiteInfo,
    saveClientLocationOverride,
    addToast,
  } = useApp();

  const client = clientId ? getClientById(clientId) : undefined;
  const stop = route?.stops.find(s => s.client_id === clientId);
  const stopIndex = route?.stops.findIndex(s => s.client_id === clientId) ?? -1;

  // Form state
  const [binsCollected, setBinsCollected] = useState(client?.expected_quantity || 1);
  const [binFullness, setBinFullness] = useState<(BinFullness | null)[]>([]);
  const [binSerialNumbers, setBinSerialNumbers] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [report, setReport] = useState<PickupReport | null>(null);
  const [existingPickupId, setExistingPickupId] = useState<string | null>(null);

  // Serial number modal state (for bins only)
  const [serialModalIndex, setSerialModalIndex] = useState<number | null>(null);

  // Skip flow: ask why before recording it
  const [showSkipModal, setShowSkipModal] = useState(false);

  // First-visit drop-off: driver can escape to the standard pickup form if
  // they're also collecting waste today.
  const [showStandardForm, setShowStandardForm] = useState(false);
  const isBinsCollection = client?.collection_type === 'bins';
  // Soil / green-waste: dropped at a community garden, no scan or recorded count.
  const isSoil = client?.collection_type === 'soil';
  // Brand-new off-sheet location: recorded to Pickup Notes, never the invoicing grid.
  const isNewLocation = stop?.isNewLocation === true;
  // First scheduled visit for this business — hand over the welcome kit.
  // (Soil community-garden drops don't get a marketing kit.)
  const isFirstVisit = client?.is_first_visit === true && !isSoil;

  // Double-submit guard
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Welcome kit (first visit) state
  const [welcomeKitItems] = useState<string[]>(() => getWelcomeKitItems());
  const [showWelcomeKit, setShowWelcomeKit] = useState(false);
  const [kitDelivered, setKitDelivered] = useState(false);

  // Load existing pickup if editing
  useEffect(() => {
    if (clientId) {
      const existing = getPickupByClientAndDate(clientId, getCurrentDate());
      if (existing && existing.status === 'completed') {
        setExistingPickupId(existing.id);
        setBinsCollected(existing.bins_collected);
        setBinFullness(existing.bin_fullness);
        setBinSerialNumbers(existing.bin_serial_numbers || []);
        setNotes(existing.notes);
        setPhotos(existing.photos);
        setReport(existing.report);
      }
    }
  }, [clientId, pickups]);

  // On entry to a first-visit business, pop the welcome-kit checklist — unless
  // it's already been handed over today or this pickup was completed earlier.
  useEffect(() => {
    if (!clientId || !isFirstVisit) return;
    const delivered = isKitDelivered(getCurrentDate(), clientId);
    setKitDelivered(delivered);
    const existing = getPickupByClientAndDate(clientId, getCurrentDate());
    if (!delivered && !(existing && existing.status === 'completed')) {
      setShowWelcomeKit(true);
    }
  }, [clientId, isFirstVisit]);

  const handleWelcomeKitConfirm = () => {
    if (!clientId) return;
    markKitDelivered(getCurrentDate(), clientId);
    setKitDelivered(true);
    setShowWelcomeKit(false);
    // Record the hand-over in the pickup note so it reaches the Pickup Notes tab.
    const kitLine = `Welcome kit delivered (${welcomeKitItems.join(', ')})`;
    setNotes(prev =>
      prev.includes('Welcome kit delivered')
        ? prev
        : prev.trim()
          ? `${prev.trim()} · ${kitLine}`
          : kitLine
    );
    addToast('success', 'Welcome kit checked off');
  };

  // Initialize fullness and serial number arrays when bins count changes
  useEffect(() => {
    setBinFullness(prev => {
      const newArray = [...prev];
      while (newArray.length < binsCollected) {
        newArray.push(null);
      }
      return newArray.slice(0, binsCollected);
    });
    setBinSerialNumbers(prev => {
      const newArray = [...prev];
      while (newArray.length < binsCollected) {
        newArray.push('');
      }
      return newArray.slice(0, binsCollected);
    });
  }, [binsCollected]);

  // Redirect if not authenticated, invalid client, or in read-only mode
  useEffect(() => {
    if (!collector) {
      navigate('/');
    } else if (!client) {
      navigate('/route');
    } else if (isReadOnlyView) {
      // Redirect back to route list if trying to access pickup in read-only mode
      navigate('/route');
    }
  }, [collector, client, isReadOnlyView, navigate]);

  if (!collector || !client || !route || !stop || isReadOnlyView) {
    return null;
  }

  const handleFullnessChange = (index: number, value: BinFullness) => {
    setBinFullness(prev => {
      const newArray = [...prev];
      newArray[index] = value;
      return newArray;
    });

    // For bins (not buckets), show serial number modal immediately
    if (isBinsCollection && !binSerialNumbers[index]) {
      setSerialModalIndex(index);
    }
  };

  const handleSerialNumberChange = (index: number, value: string) => {
    // Allow letters and digits, convert to uppercase
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    setBinSerialNumbers(prev => {
      const newArray = [...prev];
      newArray[index] = cleaned;
      return newArray;
    });
  };

  const handleSerialModalSubmit = (serialNumber: string) => {
    if (serialModalIndex !== null) {
      handleSerialNumberChange(serialModalIndex, serialNumber);
      setSerialModalIndex(null);
    }
  };

  const adjustBinCount = (delta: number) => {
    const newCount = Math.max(1, Math.min(10, binsCollected + delta));
    setBinsCollected(newCount);
  };

  // Validation: all items need fullness, only bins need serial numbers
  const isFormValid = binFullness.every(f => f !== null) &&
                      (!isBinsCollection || binSerialNumbers.every(s => s.length >= 3));

  // For a brand-new off-sheet location, prepend the address + reason so the
  // Pickup Notes entry carries everything accounts need to follow up.
  const composeNote = (baseNotes: string): string => {
    if (!isNewLocation) return baseNotes;
    const reasonLabel = stop?.adHocReason ? NEW_LOCATION_REASON_LABELS[stop.adHocReason] : '';
    const parts = [
      `NEW LOCATION — ${client.address || 'no address given'}`,
      reasonLabel,
      baseNotes,
    ].filter(Boolean);
    return parts.join(' · ');
  };

  // Soil / green-waste sign-off: mark done, log a note, but DON'T record a bin
  // count to the sheet and DON'T create consolidation tiles (bins_collected: 0).
  const handleSoilDone = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const pickup: PickupRecord = {
      id: existingPickupId || generateId(),
      date: getCurrentDate(),
      time: getCurrentTime(),
      client_id: client.id,
      collector_id: collector.id,
      bins_collected: 0,
      bin_fullness: [],
      bin_serial_numbers: [],
      notes: notes.trim() || 'Soil / green-waste dropped at community garden',
      photos: [],
      report: null,
      status: 'completed',
    };

    if (existingPickupId) {
      updatePickup(pickup);
    } else {
      addPickup(pickup);
    }
    updateStopStatus(client.id, 'completed');

    queueNoteWrite({
      date: pickup.date,
      time: pickup.time,
      businessName: client.business_name,
      collectorName: collector.name,
      status: 'completed',
      binsCollected: 0,
      notes: composeNote(pickup.notes),
    });

    navigate(`/confirmation/${client.id}`);
  };

  const handleComplete = () => {
    if (isSubmitting) return;
    if (!binFullness.every(f => f !== null)) {
      alert(`Please select fullness for all ${unitName}`);
      return;
    }
    if (isBinsCollection && !binSerialNumbers.every(s => s.length >= 3)) {
      alert('Please enter serial number for all bins');
      return;
    }
    setIsSubmitting(true);

    const pickup: PickupRecord = {
      id: existingPickupId || generateId(),
      date: getCurrentDate(),
      time: getCurrentTime(),
      client_id: client.id,
      collector_id: collector.id,
      bins_collected: binsCollected,
      bin_fullness: binFullness as BinFullness[],
      bin_serial_numbers: binSerialNumbers,
      notes,
      photos,
      report: report?.issue || report?.action ? report : null,
      status: 'completed',
    };

    if (existingPickupId) {
      updatePickup(pickup);
    } else {
      addPickup(pickup);
    }
    updateStopStatus(client.id, 'completed');

    // New off-sheet locations are NOT written to the invoicing grid — they have
    // no schedule row. They're captured in Pickup Notes instead (always).
    if (!isNewLocation) {
      recordBinCount(client.id, binsCollected);
    }

    // Queue note to Pickup Notes sheet (offline-resilient). Always for new
    // locations (so accounts can act on them); otherwise only if there's a note.
    if (isNewLocation || notes.trim()) {
      queueNoteWrite({
        date: pickup.date,
        time: pickup.time,
        businessName: client.business_name,
        collectorName: collector.name,
        status: 'completed',
        binsCollected,
        notes: composeNote(notes.trim()),
      });
    }

    // Queue report email if there's a report (offline-resilient)
    if (pickup.report && pickup.report.issue) {
      queueEmailSend({
        businessName: client.business_name,
        collectorName: collector.name,
        reportType: 'pickup',
        report: pickup.report,
        photos,
      });
    }

    navigate(`/confirmation/${client.id}`);
  };

  // First-visit drop-off: hand over empty bins + welcome kit, nothing collected.
  // bins_collected: 0 so no consolidation tiles get created downstream.
  const handleFirstVisitDropOff = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const dropOffNote = `First visit — dropped off ${binsCollected} ${unitName}`;
    const combinedNotes = notes.trim() ? `${dropOffNote} · ${notes.trim()}` : dropOffNote;

    const pickup: PickupRecord = {
      id: existingPickupId || generateId(),
      date: getCurrentDate(),
      time: getCurrentTime(),
      client_id: client.id,
      collector_id: collector.id,
      bins_collected: 0,
      bin_fullness: [],
      bin_serial_numbers: [],
      notes: combinedNotes,
      photos: [],
      report: null,
      status: 'completed',
    };

    if (existingPickupId) {
      updatePickup(pickup);
    } else {
      addPickup(pickup);
    }
    updateStopStatus(client.id, 'completed');

    // Writes 0 to the grid so the drop-off isn't billed as a collection.
    if (!isNewLocation) {
      recordBinCount(client.id, 0);
    }

    queueNoteWrite({
      date: pickup.date,
      time: pickup.time,
      businessName: client.business_name,
      collectorName: collector.name,
      status: 'completed',
      binsCollected: 0,
      notes: composeNote(combinedNotes),
    });

    navigate(`/confirmation/${client.id}`);
  };

  // Opens the "why are you skipping" modal rather than skipping immediately.
  const handleSkip = () => {
    if (isSubmitting) return;
    setShowSkipModal(true);
  };

  // aborted = customer's bins weren't out — a chargeable aborted pickup rather
  // than a free skip. Only offered for scheduled on-sheet stops (see
  // showChargeOption on the modal below).
  const performSkip = (aborted: boolean) => {
    if (isSubmitting) return;
    setShowSkipModal(false);
    setIsSubmitting(true);

    const abortedCount = Math.max(1, client.expected_quantity || 1);
    const baseNotes = aborted
      ? `ABORTED PICKUP — bins not out, charge ${abortedCount} ${unitName}`
      : notes || 'Skipped';
    const combinedNotes = aborted && notes.trim() ? `${baseNotes} · ${notes.trim()}` : baseNotes;

    const pickup: PickupRecord = {
      id: generateId(),
      date: getCurrentDate(),
      time: getCurrentTime(),
      client_id: client.id,
      collector_id: collector.id,
      bins_collected: 0,
      bin_fullness: [],
      bin_serial_numbers: [],
      notes: combinedNotes,
      photos: [],
      report: report?.issue || report?.action ? report : null,
      status: 'skipped',
      ...(aborted ? { aborted: true } : {}),
    };

    addPickup(pickup);
    updateStopStatus(client.id, 'skipped');

    if (aborted) {
      // Overwrites the marker + count cells so the aborted visit still bills.
      recordAbortedPickup(client.id);
    } else if (!isNewLocation) {
      // Queue zero for write-back (skipped) — but new locations have no grid row.
      recordBinCount(client.id, 0);
    }

    // Always queue skips for the Pickup Notes sheet (offline-resilient)
    queueNoteWrite({
      date: pickup.date,
      time: pickup.time,
      businessName: client.business_name,
      collectorName: collector.name,
      status: 'skipped',
      binsCollected: 0,
      notes: composeNote(combinedNotes),
    });

    // Queue report email if there's a report (offline-resilient)
    if (pickup.report && pickup.report.issue) {
      queueEmailSend({
        businessName: client.business_name,
        collectorName: collector.name,
        reportType: 'pickup',
        report: pickup.report,
        photos,
      });
    }

    navigate('/route');
  };

  const unitName = client.collection_type === 'bins' ? 'bins' : 'buckets';
  const unitNameSingular = client.collection_type === 'bins' ? 'bin' : 'bucket';

  // Soil / green-waste stops get a stripped-back sign-off screen — no count,
  // fullness, serial scan or photos. Just drop at the community garden + tap Done.
  if (isSoil) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title={`Stop ${stopIndex + 1} of ${route.stops.length}`} showBack />

        {/* Client Info */}
        <div className="bg-white px-4 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{client.business_name}</h2>
          <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
            <MapPin size={14} />
            <span>{client.address || 'No address provided'}</span>
          </div>
          {(client.contact_name || client.contact_phone) && (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-700">
              {client.contact_name && (
                <div className="flex items-center gap-1">
                  <User size={14} className="text-gray-500" />
                  <span>{client.contact_name}</span>
                </div>
              )}
              {client.contact_phone && (
                <a
                  href={`tel:${client.contact_phone.replace(/\s+/g, '')}`}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
                >
                  <Phone size={14} />
                  <span>{client.contact_phone}</span>
                </a>
              )}
            </div>
          )}
          {client.delivery_notes && (
            <div className="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <span className="text-sm text-amber-800">{client.delivery_notes}</span>
            </div>
          )}
          <ApproachSection
            approachFrom={client.approach_from}
            collectionType={client.collection_type}
            onSave={approachFrom => saveSiteInfo(client.id, {
              instructions: client.find_instructions || '',
              media: client.find_media || [],
              approach_from: approachFrom,
            })}
          />
          <FindBinsSection
            businessName={client.business_name}
            instructions={client.find_instructions}
            media={client.find_media}
            onSave={data => saveSiteInfo(client.id, { ...data, approach_from: client.approach_from || '' })}
          />
          {!isNewLocation && (
            <LocationOverrideSection
              businessName={client.business_name}
              manualLat={client.manual_lat}
              manualLng={client.manual_lng}
              onSave={(lat, lng) => saveClientLocationOverride(client.id, lat, lng)}
            />
          )}
          <div className="flex items-center gap-1 text-sm text-gray-600 mt-2">
            <Sprout size={14} className="text-amber-600" />
            <span>Soil / green-waste · {client.expected_quantity}x bin</span>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
            <Sprout className="shrink-0 mt-0.5" size={18} />
            <span>
              Drop the soil / green-waste bin at the community garden. No mulch or biochar prep,
              no scan and no count — just confirm it's done.
            </span>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
              placeholder="Any notes about this drop-off..."
            />
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <Button fullWidth size="lg" onClick={handleSoilDone} disabled={isSubmitting}>
              <span className="flex items-center justify-center gap-2">
                <Check size={20} />
                {isSubmitting ? 'Saving…' : existingPickupId ? 'Update' : 'Done — dropped at community garden'}
              </span>
            </Button>
            <Button fullWidth variant="outline" onClick={handleSkip} disabled={isSubmitting}>
              Skip This Stop
            </Button>
          </div>
        </div>

        <div className="h-8" />

        <SkipReasonModal
          isOpen={showSkipModal}
          businessName={client.business_name}
          showChargeOption={!isNewLocation && !stop?.isAdHoc}
          onAborted={() => performSkip(true)}
          onNoCharge={() => performSkip(false)}
          onCancel={() => setShowSkipModal(false)}
        />
      </div>
    );
  }

  // First-visit drop-off: new customer's first scheduled visit is a hand-over
  // of empty bins + welcome kit, not a collection. Skip the fullness/serial
  // scan flow entirely. Falls through to the standard form once the driver
  // taps the escape hatch, or if there's already a completed record to edit.
  if (isFirstVisit && !existingPickupId && !showStandardForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title={`Stop ${stopIndex + 1} of ${route.stops.length}`} showBack />

        {/* Client Info */}
        <div className="bg-white px-4 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900">{client.business_name}</h2>
              <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
                <MapPin size={14} />
                <span>{client.address || 'No address provided'}</span>
              </div>
            </div>
            {client.logo_url && (
              <img
                src={client.logo_url}
                alt={`${client.business_name} logo`}
                className="w-16 h-16 object-contain rounded shrink-0"
              />
            )}
          </div>
          {(client.contact_name || client.contact_phone) && (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-700">
              {client.contact_name && (
                <div className="flex items-center gap-1">
                  <User size={14} className="text-gray-500" />
                  <span>{client.contact_name}</span>
                </div>
              )}
              {client.contact_phone && (
                <a
                  href={`tel:${client.contact_phone.replace(/\s+/g, '')}`}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
                >
                  <Phone size={14} />
                  <span>{client.contact_phone}</span>
                </a>
              )}
            </div>
          )}
          {client.delivery_notes && (
            <div className="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <span className="text-sm text-amber-800">{client.delivery_notes}</span>
            </div>
          )}
          <ApproachSection
            approachFrom={client.approach_from}
            collectionType={client.collection_type}
            onSave={approachFrom => saveSiteInfo(client.id, {
              instructions: client.find_instructions || '',
              media: client.find_media || [],
              approach_from: approachFrom,
            })}
          />
          <FindBinsSection
            businessName={client.business_name}
            instructions={client.find_instructions}
            media={client.find_media}
            onSave={data => saveSiteInfo(client.id, { ...data, approach_from: client.approach_from || '' })}
          />
          {!isNewLocation && (
            <LocationOverrideSection
              businessName={client.business_name}
              manualLat={client.manual_lat}
              manualLng={client.manual_lng}
              onSave={(lat, lng) => saveClientLocationOverride(client.id, lat, lng)}
            />
          )}

          {/* First-visit welcome kit reminder */}
          <div
            className={`flex items-start gap-2 mt-3 rounded-lg px-3 py-2 border ${
              kitDelivered ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}
          >
            <Gift
              size={16}
              className={`mt-0.5 shrink-0 ${kitDelivered ? 'text-green-600' : 'text-amber-600'}`}
            />
            <div className="text-sm">
              {kitDelivered ? (
                <span className="text-green-800 font-medium">Welcome kit handed over ✓</span>
              ) : (
                <span className="text-amber-800">
                  <span className="font-semibold">First visit — hand over the welcome kit:</span>{' '}
                  {welcomeKitItems.join(', ')}.{' '}
                  <button
                    type="button"
                    onClick={() => setShowWelcomeKit(true)}
                    className="underline font-medium"
                  >
                    Open checklist
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="flex items-start gap-2 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-3">
            <Gift className="shrink-0 mt-0.5" size={18} />
            <span>
              First visit — this is a drop-off. Leave the empty {unitName} and welcome kit;
              nothing is collected today.
            </span>
          </div>

          {/* Bins dropped off */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              How many {unitName} dropped off?
            </label>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300 p-1">
                <button
                  onClick={() => adjustBinCount(-1)}
                  className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  disabled={binsCollected <= 1}
                >
                  <Minus size={20} />
                </button>
                <span className="w-12 text-center text-xl font-bold">
                  {binsCollected}
                </span>
                <button
                  onClick={() => adjustBinCount(1)}
                  className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  disabled={binsCollected >= 10}
                >
                  <Plus size={20} />
                </button>
              </div>
              <span className="text-gray-600">{unitName}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
              placeholder="Any notes about this drop-off..."
            />
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <Button fullWidth size="lg" onClick={handleFirstVisitDropOff} disabled={isSubmitting}>
              <span className="flex items-center justify-center gap-2">
                <Check size={20} />
                {isSubmitting ? 'Saving…' : 'Drop-off done'}
              </span>
            </Button>
            <button
              type="button"
              onClick={() => setShowStandardForm(true)}
              className="w-full text-center text-sm text-green-primary hover:underline"
            >
              Collecting waste too? Record a normal pickup
            </button>
            <Button fullWidth variant="outline" onClick={handleSkip} disabled={isSubmitting}>
              Skip This Stop
            </Button>
          </div>
        </div>

        <div className="h-8" />

        {/* Welcome Kit checklist */}
        <WelcomeKitModal
          isOpen={showWelcomeKit}
          businessName={client.business_name}
          items={welcomeKitItems}
          onConfirm={handleWelcomeKitConfirm}
          onLater={() => setShowWelcomeKit(false)}
        />

        <SkipReasonModal
          isOpen={showSkipModal}
          businessName={client.business_name}
          showChargeOption={!isNewLocation && !stop?.isAdHoc}
          onAborted={() => performSkip(true)}
          onNoCharge={() => performSkip(false)}
          onCancel={() => setShowSkipModal(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title={`Stop ${stopIndex + 1} of ${route.stops.length}`} showBack />

      {/* Client Info */}
      <div className="bg-white px-4 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">{client.business_name}</h2>
            <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
              <MapPin size={14} />
              <span>{client.address || 'No address provided'}</span>
            </div>
          </div>
          {client.logo_url && (
            <img
              src={client.logo_url}
              alt={`${client.business_name} logo`}
              className="w-16 h-16 object-contain rounded shrink-0"
            />
          )}
        </div>
        {(client.contact_name || client.contact_phone) && (
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-700">
            {client.contact_name && (
              <div className="flex items-center gap-1">
                <User size={14} className="text-gray-500" />
                <span>{client.contact_name}</span>
              </div>
            )}
            {client.contact_phone && (
              <a
                href={`tel:${client.contact_phone.replace(/\s+/g, '')}`}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
              >
                <Phone size={14} />
                <span>{client.contact_phone}</span>
              </a>
            )}
          </div>
        )}
        {client.delivery_notes && (
          <div className="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <span className="text-sm text-amber-800">{client.delivery_notes}</span>
          </div>
        )}
        <ApproachSection
          approachFrom={client.approach_from}
          collectionType={client.collection_type}
          onSave={approachFrom => saveSiteInfo(client.id, {
            instructions: client.find_instructions || '',
            media: client.find_media || [],
            approach_from: approachFrom,
          })}
        />
        <FindBinsSection
          businessName={client.business_name}
          instructions={client.find_instructions}
          media={client.find_media}
          onSave={data => saveSiteInfo(client.id, { ...data, approach_from: client.approach_from || '' })}
        />
        {!isNewLocation && (
          <LocationOverrideSection
            businessName={client.business_name}
            manualLat={client.manual_lat}
            manualLng={client.manual_lng}
            onSave={(lat, lng) => saveClientLocationOverride(client.id, lat, lng)}
          />
        )}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <Trash2 size={14} />
            <span>
              Expected: {client.expected_quantity}x {unitName}
            </span>
          </div>
          {client.paper_towel_pickup && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              + Paper towels
            </span>
          )}
        </div>

        {/* First-visit welcome kit reminder */}
        {isFirstVisit && (
          <div
            className={`flex items-start gap-2 mt-3 rounded-lg px-3 py-2 border ${
              kitDelivered ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}
          >
            <Gift
              size={16}
              className={`mt-0.5 shrink-0 ${kitDelivered ? 'text-green-600' : 'text-amber-600'}`}
            />
            <div className="text-sm">
              {kitDelivered ? (
                <span className="text-green-800 font-medium">Welcome kit handed over ✓</span>
              ) : (
                <span className="text-amber-800">
                  <span className="font-semibold">First visit — hand over the welcome kit:</span>{' '}
                  {welcomeKitItems.join(', ')}.{' '}
                  <button
                    type="button"
                    onClick={() => setShowWelcomeKit(true)}
                    className="underline font-medium"
                  >
                    Open checklist
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Form */}
      <div className="p-4 space-y-6">
        {/* Bin Count */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            How many {unitName} collected?
          </label>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300 p-1">
              <button
                onClick={() => adjustBinCount(-1)}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                disabled={binsCollected <= 1}
              >
                <Minus size={20} />
              </button>
              <span className="w-12 text-center text-xl font-bold">
                {binsCollected}
              </span>
              <button
                onClick={() => adjustBinCount(1)}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                disabled={binsCollected >= 10}
              >
                <Plus size={20} />
              </button>
            </div>
            <span className="text-gray-600">{unitName}</span>
          </div>

          {/* Quick select buttons */}
          <div className="flex gap-2 mt-3">
            {[1, 2, 3].map(num => (
              <button
                key={num}
                onClick={() => setBinsCollected(num)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  binsCollected === num
                    ? 'bg-green-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {num}
              </button>
            ))}
            <button
              onClick={() => adjustBinCount(1)}
              className="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              +
            </button>
          </div>
        </div>

        {/* Fullness and Serial Number for each bin */}
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            {unitNameSingular.charAt(0).toUpperCase() + unitNameSingular.slice(1)} details
          </label>
          {Array.from({ length: binsCollected }).map((_, index) => (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-3 space-y-3">
              <div className="text-sm font-medium text-gray-600">
                {unitNameSingular.charAt(0).toUpperCase() + unitNameSingular.slice(1)} {index + 1}
              </div>
              <FullnessSelector
                index={index}
                value={binFullness[index] || null}
                onChange={value => handleFullnessChange(index, value)}
                collectionType={client.collection_type}
              />
              {/* Serial number display - only for bins, shows after it's been entered */}
              {isBinsCollection && binFullness[index] && binSerialNumbers[index] && (
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check size={16} className="text-green-600" />
                      <span className="text-sm font-mono font-medium text-gray-900">
                        #{binSerialNumbers[index]}
                      </span>
                    </div>
                    <button
                      onClick={() => setSerialModalIndex(index)}
                      className="text-xs text-green-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}
              {/* Prompt to add serial - only for bins, when fullness selected but no serial yet */}
              {isBinsCollection && binFullness[index] && !binSerialNumbers[index] && (
                <div className="pt-2 border-t border-gray-100">
                  <button
                    onClick={() => setSerialModalIndex(index)}
                    className="w-full py-2 text-sm text-green-primary border border-green-primary rounded-lg hover:bg-green-50 transition-colors"
                  >
                    + Add Serial Number
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
            placeholder="Any notes about this pickup..."
          />
        </div>

        {/* Photos */}
        <PhotoSection
          photos={photos}
          onChange={setPhotos}
          businessName={client.business_name}
          date={getCurrentDate()}
        />

        {/* Report Section */}
        <ReportSection report={report} onChange={setReport} />

        {/* Action Buttons */}
        <div className="space-y-3 pt-4">
          <Button fullWidth size="lg" onClick={handleComplete} disabled={!isFormValid || isSubmitting}>
            {isSubmitting ? 'Saving…' : existingPickupId ? 'Update Pickup' : 'Complete Pickup'}
          </Button>
          <Button fullWidth variant="outline" onClick={handleSkip} disabled={isSubmitting}>
            Skip This Stop
          </Button>
        </div>
      </div>

      {/* Bottom padding */}
      <div className="h-8" />

      {/* Serial Number Modal - for bins only */}
      <SerialNumberModal
        isOpen={serialModalIndex !== null}
        onClose={() => setSerialModalIndex(null)}
        onSubmit={handleSerialModalSubmit}
      />

      {/* Welcome Kit checklist - first visit only */}
      <WelcomeKitModal
        isOpen={showWelcomeKit}
        businessName={client.business_name}
        items={welcomeKitItems}
        onConfirm={handleWelcomeKitConfirm}
        onLater={() => setShowWelcomeKit(false)}
      />

      <SkipReasonModal
        isOpen={showSkipModal}
        businessName={client.business_name}
        showChargeOption={!isNewLocation && !stop?.isAdHoc}
        onAborted={() => performSkip(true)}
        onNoCharge={() => performSkip(false)}
        onCancel={() => setShowSkipModal(false)}
      />
    </div>
  );
}
