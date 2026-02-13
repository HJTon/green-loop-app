import { useState } from 'react';
import { X, Camera, Keyboard, Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/Button';
import { CameraCapture } from './CameraCapture';
import { recognizeSerialNumber, validateSerialNumber, formatSerialNumber } from '@/services/ocrService';

interface SerialNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (serialNumber: string) => void;
}

type Mode = 'choose' | 'camera' | 'manual' | 'processing' | 'confirm';

export function SerialNumberModal({ isOpen, onClose, onSubmit }: SerialNumberModalProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [serialNumber, setSerialNumber] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCapture = async (imageData: string) => {
    setMode('processing');
    setError(null);

    try {
      const result = await recognizeSerialNumber(imageData);
      setSerialNumber(result.suggestedSerial);
      setConfidence(result.confidence);
      setMode('confirm');
    } catch (err) {
      console.error('OCR error:', err);
      setError('Failed to read serial number. Please try again or enter manually.');
      setMode('manual');
    }
  };

  const handleManualChange = (value: string) => {
    // Only allow digits
    const cleaned = value.replace(/[^0-9]/g, '');
    setSerialNumber(cleaned);
    setError(null);
  };

  const handleSubmit = () => {
    const validation = validateSerialNumber(serialNumber);
    if (!validation.valid) {
      setError(validation.error || 'Invalid serial number');
      return;
    }

    const formatted = formatSerialNumber(serialNumber);
    onSubmit(formatted);
    handleClose();
  };

  const handleClose = () => {
    setMode('choose');
    setSerialNumber('');
    setConfidence(0);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'choose' && 'Select Maturing Bin'}
            {mode === 'camera' && 'Scan Serial Number'}
            {mode === 'manual' && 'Enter Serial Number'}
            {mode === 'processing' && 'Reading...'}
            {mode === 'confirm' && 'Confirm Serial Number'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Choose mode */}
          {mode === 'choose' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">
                How would you like to enter the bin serial number?
              </p>
              <button
                onClick={() => setMode('camera')}
                className="w-full flex items-center gap-3 p-4 bg-gray-50 rounded-lg border-2 border-gray-200 hover:border-green-primary hover:bg-green-50 transition-colors"
              >
                <div className="w-10 h-10 bg-green-primary rounded-full flex items-center justify-center">
                  <Camera size={20} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Scan with Camera</p>
                  <p className="text-sm text-gray-500">Point camera at the serial number</p>
                </div>
              </button>
              <button
                onClick={() => setMode('manual')}
                className="w-full flex items-center gap-3 p-4 bg-gray-50 rounded-lg border-2 border-gray-200 hover:border-green-primary hover:bg-green-50 transition-colors"
              >
                <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center">
                  <Keyboard size={20} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Enter Manually</p>
                  <p className="text-sm text-gray-500">Type the serial number</p>
                </div>
              </button>
            </div>
          )}

          {/* Camera mode */}
          {mode === 'camera' && (
            <CameraCapture
              onCapture={handleCapture}
              onCancel={() => setMode('choose')}
            />
          )}

          {/* Processing mode */}
          {mode === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={48} className="text-green-primary animate-spin mb-4" />
              <p className="text-gray-600">Reading serial number...</p>
            </div>
          )}

          {/* Manual entry mode */}
          {mode === 'manual' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serial Number
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={serialNumber}
                  onChange={e => handleManualChange(e.target.value)}
                  placeholder="e.g., 000032344"
                  className="w-full px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent"
                  autoFocus
                />
                {error && (
                  <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle size={14} />
                    {error}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setMode('choose')} fullWidth>
                  Back
                </Button>
                <Button onClick={handleSubmit} fullWidth disabled={!serialNumber}>
                  Add Bin
                </Button>
              </div>
            </div>
          )}

          {/* Confirm mode */}
          {mode === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-500 mb-1">Detected Serial Number</p>
                <p className="text-2xl font-mono font-bold text-gray-900">{serialNumber}</p>
                {confidence > 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    Confidence: {Math.round(confidence * 100)}%
                  </p>
                )}
              </div>

              {confidence < 0.8 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-800">
                    Low confidence reading. Please verify the number is correct.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Edit if needed
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={serialNumber}
                  onChange={e => handleManualChange(e.target.value)}
                  className="w-full px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent"
                />
                {error && (
                  <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle size={14} />
                    {error}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setMode('camera')} fullWidth>
                  Retake
                </Button>
                <Button onClick={handleSubmit} fullWidth>
                  <Check size={18} className="mr-1" />
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
