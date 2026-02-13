import { Camera, X } from 'lucide-react';
import { useState } from 'react';

// Placeholder for now - real photo upload coming when Google Workspace is set up
const placeholderImages = [
  '/bin1.jpg',
  '/bin2.jpg',
  '/bin3.jpg',
];

interface PhotoSectionProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  businessName?: string;
  date?: string;
}

export function PhotoSection({ photos, onChange }: PhotoSectionProps) {
  const [nextPhotoIndex, setNextPhotoIndex] = useState(0);

  const addPhoto = () => {
    if (photos.length < 3) {
      const newPhoto = placeholderImages[nextPhotoIndex % 3];
      onChange([...photos, newPhoto]);
      setNextPhotoIndex(prev => prev + 1);
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
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {photos.length < 3 && (
          <button
            onClick={addPhoto}
            className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-green-primary hover:text-green-primary transition-colors"
          >
            <Camera size={24} />
            <span className="text-xs mt-1">Add</span>
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Photo upload coming soon
      </p>
    </div>
  );
}
