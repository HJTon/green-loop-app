import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Edit, ArrowRight, Truck, MapPin } from 'lucide-react';
import { Button } from '@/components/Button';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import { getPickupByClientAndDate, getCurrentDate } from '@/utils/storage';

export function ConfirmationPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { collector, route, completedCount, totalStops, getClientById } = useApp();

  const client = clientId ? getClientById(clientId) : undefined;
  const pickup = clientId ? getPickupByClientAndDate(clientId, getCurrentDate()) : null;
  const allComplete = completedCount === totalStops;
  const destinationFarm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  // Find next pending stop
  const nextStop = route?.stops
    .sort((a, b) => a.position - b.position)
    .find(s => s.status === 'pending');

  const nextClient = nextStop ? getClientById(nextStop.client_id) : undefined;

  useEffect(() => {
    if (!collector) {
      navigate('/');
    } else if (!client) {
      navigate('/route');
    }
  }, [collector, client, navigate]);

  if (!collector || !client || !pickup) {
    return null;
  }

  const handleEdit = () => {
    navigate(`/pickup/${clientId}`);
  };

  const handleNext = () => {
    if (allComplete) {
      // All pickups done - go to drop-off
      navigate('/dropoff');
    } else if (nextStop) {
      navigate(`/pickup/${nextStop.client_id}`);
    } else {
      navigate('/route');
    }
  };

  const handleBackToRoute = () => {
    navigate('/route');
  };

  const unitName = client.collection_type === 'bins' ? 'bins' : 'buckets';
  const isSoil = client.collection_type === 'soil';

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex flex-col items-center justify-center px-4">
      {/* Success Icon */}
      <div className="mb-6 animate-bounce-once">
        <CheckCircle className="w-24 h-24 text-green-primary" strokeWidth={1.5} />
      </div>

      {/* Success Message */}
      <h1 className="text-2xl font-bold text-green-dark mb-2">Pickup Logged!</h1>

      {/* Details */}
      <div className="bg-white rounded-xl shadow-md p-6 w-full max-w-sm mb-8">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">Business</span>
            <span className="font-semibold text-gray-900">{client.business_name}</span>
          </div>
          {isSoil ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Soil / green-waste</span>
              <span className="font-semibold text-gray-900">Dropped at community garden</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Collected</span>
                <span className="font-semibold text-gray-900">
                  {pickup.bins_collected} {unitName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Fullness</span>
                <span className="font-semibold text-gray-900">
                  {pickup.bin_fullness.join(', ')}
                </span>
              </div>
            </>
          )}
          {pickup.notes && (
            <div className="pt-2 border-t border-gray-100">
              <span className="text-gray-600 text-sm">Notes: </span>
              <span className="text-gray-800 text-sm">{pickup.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="text-center mb-8">
        <p className="text-gray-600">
          {completedCount} of {totalStops} stops completed
        </p>
        {allComplete && destinationFarm && (
          <p className="text-green-primary font-semibold mt-1">
            All pickups done! Head to {destinationFarm.farm_name}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="w-full max-w-sm space-y-3">
        <div>
          <Button fullWidth size="lg" onClick={handleNext}>
            <span className="flex items-center justify-center gap-2">
              {allComplete ? (
                <>
                  <Truck size={20} />
                  Go to Drop-off
                </>
              ) : (
                <>
                  Next Stop
                  <ArrowRight size={20} />
                </>
              )}
            </span>
          </Button>

          {/* Next stop info */}
          {!allComplete && nextClient && (
            <div className="mt-2 text-center">
              <p className="font-medium text-gray-900">{nextClient.business_name}</p>
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">
                <MapPin size={12} />
                {nextClient.address}
              </p>
            </div>
          )}

          {/* Drop-off info */}
          {allComplete && destinationFarm && (
            <div className="mt-2 text-center">
              <p className="font-medium text-gray-900">{destinationFarm.farm_name}</p>
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">
                <MapPin size={12} />
                {destinationFarm.address}
              </p>
            </div>
          )}
        </div>

        <Button fullWidth variant="outline" onClick={handleEdit}>
          <span className="flex items-center justify-center gap-2">
            <Edit size={18} />
            Edit This Pickup
          </span>
        </Button>

        <Button fullWidth variant="ghost" onClick={handleBackToRoute}>
          Back to Route List
        </Button>
      </div>
    </div>
  );
}
