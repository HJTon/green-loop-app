import { useState } from 'react';
import { Delete } from 'lucide-react';

interface PinPadProps {
  onSubmit: (pin: string) => void;
  error?: string;
}

export function PinPad({ onSubmit, error }: PinPadProps) {
  const [pin, setPin] = useState('');

  const handleNumber = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        onSubmit(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  return (
    <div className="flex flex-col items-center">
      {/* PIN Display */}
      <div className="flex gap-3 mb-6">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
              i < pin.length
                ? 'bg-green-primary border-green-primary'
                : 'border-gray-300'
            }`}
          />
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-red-500 text-sm mb-4 animate-shake">{error}</p>
      )}

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            onClick={() => handleNumber(num.toString())}
            className="w-16 h-16 rounded-full bg-gray-100 text-2xl font-semibold text-gray-800 hover:bg-gray-200 active:bg-gray-300 active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-green-primary"
          >
            {num}
          </button>
        ))}
        <button
          onClick={handleClear}
          className="w-16 h-16 rounded-full bg-gray-100 text-sm font-medium text-gray-600 hover:bg-gray-200 active:bg-gray-300 active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-green-primary"
        >
          Clear
        </button>
        <button
          onClick={() => handleNumber('0')}
          className="w-16 h-16 rounded-full bg-gray-100 text-2xl font-semibold text-gray-800 hover:bg-gray-200 active:bg-gray-300 active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-green-primary"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:bg-gray-300 active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-green-primary"
        >
          <Delete size={24} />
        </button>
      </div>
    </div>
  );
}
