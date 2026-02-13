import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinPad } from '@/components/PinPad';
import { useApp } from '@/contexts/AppContext';
import { getCollectorByPin } from '@/utils/data';
import { getDisplayDate } from '@/utils/storage';

export function LoginPage() {
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useApp();

  const handlePinSubmit = (pin: string) => {
    const collector = getCollectorByPin(pin);

    if (collector) {
      login(collector);
      navigate('/route');
    } else {
      setError('Invalid PIN');
      // Clear error after animation
      setTimeout(() => setError(''), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-6">
        <img
          src="/logo.jpg"
          alt="Green Loop"
          className="w-44 h-44 object-contain"
        />
      </div>

      {/* Date */}
      <p className="text-lg font-medium text-green-primary mb-4">
        {getDisplayDate()}
      </p>

      {/* Title */}
      <h1 className="text-2xl font-bold text-green-dark mb-2">
        Collector Login
      </h1>
      <p className="text-gray-600 mb-6">Enter your 4-digit PIN</p>

      {/* PIN Pad */}
      <PinPad onSubmit={handlePinSubmit} error={error} />

      {/* Footer */}
      <p className="text-xs text-gray-400 mt-12">
        Green Loop Collector App v1.0
      </p>
    </div>
  );
}
