import { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/Button';

interface CameraCaptureProps {
  onCapture: (imageData: string) => void;
  onCancel: () => void;
}

// The serial-number scan window, as fractions of the video frame. We crop the
// captured image to exactly this region before sending it to OCR so that a
// duplicate sticker above the bin (or a reflection) outside the box can't get
// read in and double the number. The on-screen guide uses the same fractions
// so what the driver frames is what we actually scan.
const CROP_W_FRAC = 0.82; // a touch wider so digits that drift sideways still land inside
const CROP_H_FRAC = 0.24;

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [facingMode]);

  const startCamera = async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Camera error:', err);
      setError('Unable to access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Crop to the targeting box (centred) rather than the whole frame, so only
    // the number inside the guide is sent to OCR.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sw = Math.round(vw * CROP_W_FRAC);
    const sh = Math.round(vh * CROP_H_FRAC);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    canvas.width = sw;
    canvas.height = sh;

    // Draw only the cropped source region into the canvas
    context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    // Get image data as base64
    const imageData = canvas.toDataURL('image/jpeg', 0.9);

    stopCamera();
    onCapture(imageData);
  };

  const toggleCamera = () => {
    stopCamera();
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <Camera size={48} className="text-gray-400 mb-4" />
        <p className="text-gray-600 mb-4">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={startCamera}>
            <RefreshCw size={16} className="mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Video feed */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
        />

        {/* Overlay with targeting guide — same fractions as the crop region */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="border-2 border-white/70 rounded-lg flex items-center justify-center"
            style={{ width: `${CROP_W_FRAC * 100}%`, height: `${CROP_H_FRAC * 100}%` }}
          >
            <span className="text-white/80 text-xs text-center bg-black/40 px-2 py-1 rounded">
              Fill the box with just the number
            </span>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
        >
          <X size={20} />
        </button>

        {/* Switch camera button */}
        <button
          onClick={toggleCamera}
          className="absolute top-2 left-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Capture button */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={handleCapture}
          className="w-16 h-16 bg-white rounded-full border-4 border-green-primary flex items-center justify-center hover:bg-gray-100 active:scale-95 transition-transform"
        >
          <div className="w-12 h-12 bg-green-primary rounded-full" />
        </button>
      </div>
    </div>
  );
}
