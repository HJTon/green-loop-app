import { X, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Button } from './Button';

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  availableDates?: Date[];
}

// Format date to YYYY-MM-DD in local timezone
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DatePickerModal({
  isOpen,
  onClose,
  onSelectDate,
  selectedDate,
  availableDates = [],
}: DatePickerModalProps) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  // Convert available dates to string set for quick lookup
  const availableDateStrings = useMemo(() => {
    return new Set(availableDates.map(d => formatDateLocal(d)));
  }, [availableDates]);

  if (!isOpen) return null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleString('en-NZ', { month: 'long' });

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleDateClick = (day: number) => {
    const date = new Date(viewYear, viewMonth, day);
    const dateStr = formatDateLocal(date);
    onSelectDate(dateStr);
    onClose();
  };

  const handleTodayClick = () => {
    const todayStr = formatDateLocal(today);
    onSelectDate(todayStr);
    onClose();
  };

  const renderDays = () => {
    const days = [];
    const todayStr = formatDateLocal(today);

    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="h-10" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(viewYear, viewMonth, day);
      const dateStr = formatDateLocal(date);
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedDate;
      const hasPickups = availableDateStrings.has(dateStr);

      days.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-medium transition-all relative ${
            isSelected
              ? 'bg-green-primary text-white'
              : isToday
              ? 'bg-lime-accent text-green-dark'
              : hasPickups
              ? 'bg-green-50 text-green-700 hover:bg-green-100'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {day}
          {hasPickups && !isSelected && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-primary" />
          )}
        </button>
      );
    }

    return days;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Calendar className="text-green-primary" size={20} />
            <h2 className="text-lg font-semibold text-gray-900">View Other Days</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={handlePrevMonth}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <span className="text-lg font-semibold text-gray-900">
            {monthName} {viewYear}
          </span>
          <button
            onClick={handleNextMonth}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronRight size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 gap-1 px-4 pb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div
              key={day}
              className="h-8 flex items-center justify-center text-xs font-medium text-gray-500"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1 px-4 pb-4">
          {renderDays()}
        </div>

        {/* Legend and Today button */}
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-primary" />
              <span>Has pickups</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-lime-accent" />
              <span>Today</span>
            </div>
          </div>
          <Button fullWidth variant="outline" onClick={handleTodayClick}>
            Back to Today
          </Button>
        </div>
      </div>
    </div>
  );
}
