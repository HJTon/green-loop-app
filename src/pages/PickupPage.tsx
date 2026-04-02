import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Trash2, Plus, Minus, Info, Check } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { FullnessSelector } from '@/components/FullnessSelector';
import { PhotoSection } from '@/components/PhotoSection';
import { ReportSection } from '@/components/ReportSection';
import { SerialNumberModal } from '@/components/consolidation/SerialNumberModal';
import { useApp } from '@/contexts/AppContext';
import { generateId, getCurrentDate, getCurrentTime, getPickupByClientAndDate } from '@/utils/storage';
import { sendReportEmail } from '@/services/emailService';
import type { BinFullness, PickupReport, PickupRecord } from '@/types';

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
    isReadOnlyView,
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
  const isBinsCollection = client?.collection_type === 'bins';

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

  const handleComplete = () => {
    if (!binFullness.every(f => f !== null)) {
      alert(`Please select fullness for all ${unitName}`);
      return;
    }
    if (isBinsCollection && !binSerialNumbers.every(s => s.length >= 3)) {
      alert('Please enter serial number for all bins');
      return;
    }

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

    // Queue the bin count for write-back to Google Sheets
    recordBinCount(client.id, binsCollected);

    // Send email notification if there's a report
    if (pickup.report && pickup.report.issue) {
      sendReportEmail({
        businessName: client.business_name,
        collectorName: collector.name,
        reportType: 'pickup',
        report: pickup.report,
      });
    }

    navigate(`/confirmation/${client.id}`);
  };

  const handleSkip = () => {
    const pickup: PickupRecord = {
      id: generateId(),
      date: getCurrentDate(),
      time: getCurrentTime(),
      client_id: client.id,
      collector_id: collector.id,
      bins_collected: 0,
      bin_fullness: [],
      bin_serial_numbers: [],
      notes: notes || 'Skipped',
      photos: [],
      report: report?.issue || report?.action ? report : null,
      status: 'skipped',
    };

    addPickup(pickup);
    updateStopStatus(client.id, 'skipped');

    // Queue zero for write-back (skipped)
    recordBinCount(client.id, 0);

    // Send email notification if there's a report
    if (pickup.report && pickup.report.issue) {
      sendReportEmail({
        businessName: client.business_name,
        collectorName: collector.name,
        reportType: 'pickup',
        report: pickup.report,
      });
    }

    navigate('/route');
  };

  const unitName = client.collection_type === 'bins' ? 'bins' : 'buckets';
  const unitNameSingular = client.collection_type === 'bins' ? 'bin' : 'bucket';

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
        {client.delivery_notes && (
          <div className="flex items-start gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <span className="text-sm text-amber-800">{client.delivery_notes}</span>
          </div>
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
          <Button fullWidth size="lg" onClick={handleComplete} disabled={!isFormValid}>
            {existingPickupId ? 'Update Pickup' : 'Complete Pickup'}
          </Button>
          <Button fullWidth variant="outline" onClick={handleSkip}>
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
    </div>
  );
}
