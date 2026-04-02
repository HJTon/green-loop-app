import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Header } from '@/components/Header';
import { ProgressBar } from '@/components/ProgressBar';
import { SortableStopCard } from '@/components/SortableStopCard';
import { Button } from '@/components/Button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { DatePickerModal } from '@/components/DatePickerModal';
import { useApp } from '@/contexts/AppContext';
import { getFarmById } from '@/utils/data';
import { getCurrentDate } from '@/utils/storage';
import { MapPin, Trophy, Truck, Calendar, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

export function RouteListPage() {
  const navigate = useNavigate();
  const {
    collector,
    route,
    completedCount,
    totalStops,
    reorderStops,
    allPickupsComplete,
    isLoading,
    loadError,
    selectedDate,
    isReadOnlyView,
    getClientById,
    setViewDate,
    availableDates,
    refreshData,
    addToast,
  } = useApp();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const destinationFarm = route?.destination_farm_id ? getFarmById(route.destination_farm_id) : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!collector && !isLoading) {
      navigate('/');
    }
  }, [collector, isLoading, navigate]);

  // Format date for display (parse in local timezone to avoid day shift)
  const formatDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-NZ', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading route..." fullScreen />;
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 shadow-lg max-w-sm w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load Route</h2>
          <p className="text-sm text-gray-600 mb-4">{loadError}</p>
          <Button onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!collector || !route) {
    return null;
  }

  const allComplete = completedCount === totalStops;
  const sortedStops = [...route.stops].sort((a, b) => a.position - b.position);

  const handleStopClick = (clientId: string) => {
    if (isReadOnlyView) {
      // In read-only mode, just show info (don't navigate to pickup form)
      return;
    }
    navigate(`/pickup/${clientId}`);
  };

  const handleViewSummary = () => {
    navigate('/summary');
  };

  const handleDropOff = () => {
    navigate('/dropoff');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReadOnlyView) return; // Disable reordering in read-only mode

    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedStops.findIndex(s => s.client_id === active.id);
      const newIndex = sortedStops.findIndex(s => s.client_id === over.id);
      reorderStops(oldIndex, newIndex);
    }
  };

  const handleBackToToday = () => {
    setViewDate(getCurrentDate(), false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshData();
      addToast('success', 'Route data refreshed');
    } catch (error) {
      addToast('error', 'Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title={isReadOnlyView ? 'Viewing Schedule' : "Today's Route"} showLogout />

      {/* Read-only View Banner */}
      {isReadOnlyView && (
        <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-800">
                Viewing: {formatDisplayDate(selectedDate)}
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Read-only - cannot record pickups
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleBackToToday}>
              <ArrowLeft size={16} className="mr-1" />
              Today
            </Button>
          </div>
        </div>
      )}

      {/* Progress Section */}
      <div className="bg-white px-4 py-4 border-b border-gray-200">
        {!isReadOnlyView && (
          <ProgressBar
            current={completedCount}
            total={totalStops}
            label="Route Progress"
          />
        )}

        {/* Date and View Other Days */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MapPin size={16} className="text-green-primary" />
            <span>
              {isReadOnlyView
                ? `${totalStops} stops scheduled`
                : `Starting from: ${route.start_location}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-green-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => setShowDatePicker(true)}
              className="flex items-center gap-1 text-sm text-green-primary hover:text-green-dark transition-colors"
            >
              <Calendar size={16} />
              <span>Other Days</span>
            </button>
          </div>
        </div>

        {/* Drag hint - only in edit mode */}
        {!isReadOnlyView && (
          <p className="text-xs text-gray-400 mt-2">
            Drag the handle to reorder stops
          </p>
        )}
      </div>

      {/* No Pickups Message */}
      {totalStops === 0 && (
        <div className="p-8 text-center">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">
            No Pickups Scheduled
          </h3>
          <p className="text-sm text-gray-500">
            {isReadOnlyView
              ? 'There are no pickups scheduled for this date.'
              : 'There are no pickups scheduled for today.'}
          </p>
        </div>
      )}

      {/* Route Complete Banner - only for today */}
      {!isReadOnlyView && allComplete && totalStops > 0 && (
        <div className="bg-lime-accent px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="text-green-dark" size={20} />
            <span className="font-semibold text-green-dark">
              Route Complete!
            </span>
          </div>
          <Button size="sm" onClick={handleViewSummary}>
            View Summary
          </Button>
        </div>
      )}

      {/* Stops List with Drag and Drop */}
      {totalStops > 0 && (
        <div className="p-4 space-y-3">
          <DndContext
            sensors={isReadOnlyView ? [] : sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedStops.map(s => s.client_id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedStops.map(stop => {
                const client = getClientById(stop.client_id);
                if (!client) return null;

                return (
                  <SortableStopCard
                    key={stop.client_id}
                    stop={stop}
                    client={client}
                    onClick={() => handleStopClick(stop.client_id)}
                    disabled={isReadOnlyView}
                  />
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Destination Farm - only for today */}
          {!isReadOnlyView && destinationFarm && (
            <div className="mt-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-medium">
                Destination
              </p>
              <button
                onClick={handleDropOff}
                disabled={!allPickupsComplete}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                  allPickupsComplete
                    ? 'border-lime-accent bg-lime-50 hover:bg-lime-100'
                    : 'border-gray-200 bg-gray-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        allPickupsComplete
                          ? 'bg-lime-accent text-green-dark'
                          : 'bg-gray-300 text-gray-500'
                      }`}
                    >
                      <Truck size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">
                        {destinationFarm.farm_name}
                      </h3>
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                        <MapPin size={14} />
                        <span className="truncate">{destinationFarm.address}</span>
                      </div>
                      {!allPickupsComplete && (
                        <p className="text-xs text-gray-400 mt-2">
                          Complete all pickups first
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom padding for safe area */}
      <div className="h-8" />

      {/* Date Picker Modal */}
      <DatePickerModal
        isOpen={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        onSelectDate={(date) => setViewDate(date, false)} // TEMP: Allow edits on any date for testing
        selectedDate={selectedDate}
        availableDates={availableDates}
      />
    </div>
  );
}
