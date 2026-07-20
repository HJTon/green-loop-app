import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Truck, Trash2, AlertTriangle, Download, ArrowLeft, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useApp } from '@/contexts/AppContext';
import { clients, collectors, farms, getFarmById } from '@/utils/data';
import { exportTodayData } from '@/utils/export';
import { getPendingNotes, getPendingMaturingBins } from '@/utils/storage';

export function SummaryPage() {
  const navigate = useNavigate();
  const { collector, pickups, completedCount, totalStops, resetDay, dropOff, route, pendingWrites } = useApp();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [csvExported, setCsvExported] = useState(false);

  const destinationFarm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  const todayPickups = pickups;
  const completedPickups = todayPickups.filter(p => p.status === 'completed');
  const skippedPickups = todayPickups.filter(p => p.status === 'skipped');
  const reportsCount = todayPickups.filter(p => p.report?.issue || p.report?.action).length;

  const totalBins = completedPickups.reduce((sum, p) => sum + p.bins_collected, 0);

  useEffect(() => {
    if (!collector) {
      navigate('/');
    }
  }, [collector, navigate]);

  if (!collector) {
    return null;
  }

  // Export downloads the CSV; the destructive reset only happens after the
  // driver confirms in the modal below (the CSV is the only local copy of
  // fullness/serial detail, so never wipe on the same tap that downloads it).
  const handleExport = () => {
    setCsvExported(exportTodayData(todayPickups, clients, collectors, dropOff, farms));
    setShowResetConfirm(true);
  };

  const handleConfirmReset = () => {
    setShowResetConfirm(false);
    resetDay();
    navigate('/');
  };

  // Queued sheet writes survive resetDay() and retry on next app load — this
  // count just tells the driver something hasn't landed yet.
  const pendingSyncCount =
    pendingWrites.length + getPendingNotes().length + getPendingMaturingBins().length;

  const handleBackToRoute = () => {
    navigate('/route');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Route Summary" showBack />

      {/* Hero Section */}
      <div className="bg-gradient-to-br from-green-primary to-green-dark text-white px-4 py-8 text-center">
        <Trophy className="w-16 h-16 mx-auto mb-4 text-lime-accent" />
        <h1 className="text-2xl font-bold mb-2">Route Complete!</h1>
        <p className="text-green-100">Great work today, {collector.name}</p>
      </div>

      {/* Stats Grid */}
      <div className="p-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Businesses Visited */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-green-primary mb-2">
              <Truck size={20} />
              <span className="text-sm font-medium">Visited</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{completedCount}</p>
            <p className="text-sm text-gray-500">of {totalStops} stops</p>
          </div>

          {/* Bins Collected */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-lime-accent mb-2">
              <Trash2 size={20} />
              <span className="text-sm font-medium">Collected</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{totalBins}</p>
            <p className="text-sm text-gray-500">bins/buckets</p>
          </div>

          {/* Completed */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-green-600 mb-2">
              <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-xs">
                ✓
              </span>
              <span className="text-sm font-medium">Completed</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{completedPickups.length}</p>
            <p className="text-sm text-gray-500">pickups</p>
          </div>

          {/* Skipped */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-orange-500 mb-2">
              <span className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center text-xs">
                ⏭
              </span>
              <span className="text-sm font-medium">Skipped</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{skippedPickups.length}</p>
            <p className="text-sm text-gray-500">stops</p>
          </div>
        </div>

        {/* Reports */}
        {reportsCount > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mt-4">
            <div className="flex items-center gap-2 text-orange-600 mb-1">
              <AlertTriangle size={18} />
              <span className="font-medium">{reportsCount} Report(s) Submitted</span>
            </div>
            <p className="text-sm text-orange-700">
              Reports have been logged and will be reviewed by accounts.
            </p>
          </div>
        )}

        {/* Drop-off Info */}
        {dropOff && destinationFarm && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
            <div className="flex items-center gap-2 text-green-700 mb-2">
              <Truck size={18} />
              <span className="font-medium">Dropped off at {destinationFarm.farm_name}</span>
            </div>
            <p className="text-sm text-green-600">
              {dropOff.bins_dropped} bins/buckets at {dropOff.time}
            </p>
            {dropOff.notes && (
              <p className="text-sm text-green-600 mt-1">Notes: {dropOff.notes}</p>
            )}
          </div>
        )}

        {/* Pickup Details */}
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Pickup Details</h2>
          <div className="space-y-2">
            {todayPickups.map(pickup => {
              const client = clients.find(c => c.id === pickup.client_id);
              return (
                <div
                  key={pickup.id}
                  className={`bg-white rounded-lg p-3 flex justify-between items-center ${
                    pickup.status === 'skipped' ? 'opacity-60' : ''
                  }`}
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {client?.business_name || 'Unknown'}
                    </p>
                    <p className={`text-sm ${pickup.aborted ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                      {pickup.aborted
                        ? 'Aborted — bins not out (chargeable)'
                        : pickup.status === 'skipped'
                        ? 'Skipped'
                        : client?.collection_type === 'soil'
                        ? 'Soil / green-waste dropped'
                        : `${pickup.bins_collected}x ${pickup.bin_fullness.join(', ')}`}
                    </p>
                    {pickup.notes && pickup.notes !== 'Skipped' && (
                      <p className="text-sm text-gray-600 mt-1 italic">“{pickup.notes}”</p>
                    )}
                  </div>
                  <span className="text-sm text-gray-400">{pickup.time}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Export Button */}
        <div className="mt-8 space-y-3">
          <Button fullWidth size="lg" onClick={handleExport}>
            <span className="flex items-center justify-center gap-2">
              <Download size={20} />
              Export & Start New Day
            </span>
          </Button>

          <Button fullWidth variant="outline" onClick={handleBackToRoute}>
            <span className="flex items-center justify-center gap-2">
              <ArrowLeft size={18} />
              Back to Route
            </span>
          </Button>
        </div>
      </div>

      {/* Bottom padding */}
      <div className="h-8" />

      {/* Confirm reset after export — resetDay() wipes today's local records */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Start a new day?</h2>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600">
                {csvExported
                  ? 'The CSV has been downloaded — check it saved before resetting. '
                  : 'Nothing was exported (no pickups recorded for today). '}
                Resetting clears today's pickups from this device.
              </p>
              {pendingSyncCount > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {pendingSyncCount} record{pendingSyncCount > 1 ? 's' : ''} still
                  waiting to sync to the sheet — they'll keep retrying after the
                  reset next time the app opens.
                </p>
              )}

              <Button fullWidth onClick={handleConfirmReset}>
                Reset for new day
              </Button>
              <Button fullWidth variant="outline" onClick={() => setShowResetConfirm(false)}>
                Not yet
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
