import { Camera, X, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { apiFetch } from '@/utils/apiClient';

interface PhotoSectionProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  businessName?: string;
  date?: string;
}

const MAX_PHOTOS = 3;

export function PhotoSection({ photos, onChange, businessName, date }: PhotoSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again fires change
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const base64 = await resizePhoto(file, 1600, 0.8);
      const safeName = (businessName || 'pickup').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
      const timestamp = Date.now().toString(36);
      const filename = `${date || 'undated'}_${safeName}_${timestamp}.jpg`;

      const res = await apiFetch('/.netlify/functions/media-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaData: base64,
          mimeType: 'image/jpeg',
          filename,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }

      const { url } = await res.json();
      onChange([...photos, url]);
    } catch (err) {
      console.error('Photo upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Photos (optional)
      </label>

      <div className="flex gap-3 flex-wrap">
        {photos.map((photo, index) => (
          <div key={index} className="relative">
            <img
              src={photo}
              alt={`Photo ${index + 1}`}
              className="w-20 h-20 object-cover rounded-lg border border-gray-200"
            />
            <button
              onClick={() => removePhoto(index)}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
              aria-label={`Remove photo ${index + 1}`}
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-green-primary hover:text-green-primary transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={24} className="animate-spin" />
                <span className="text-xs mt-1">Uploading</span>
              </>
            ) : (
              <>
                <Camera size={24} />
                <span className="text-xs mt-1">Add</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-red-600 mt-2">{error}</p>
      )}
    </div>
  );
}

// --- helpers ---

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function resizePhoto(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}
