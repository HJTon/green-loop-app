import type { BinFullness, CollectionType } from '@/types';

interface FullnessSelectorProps {
  index: number;
  value: BinFullness | null;
  onChange: (value: BinFullness) => void;
  collectionType: CollectionType;
}

const fullnessOptions: { value: BinFullness; label: string; percentage: number }[] = [
  { value: 'quarter', label: '1/4', percentage: 25 },
  { value: 'half', label: '1/2', percentage: 50 },
  { value: '3-quarter', label: '3/4', percentage: 75 },
  { value: 'full', label: 'Full', percentage: 100 },
];

export function FullnessSelector({
  index,
  value,
  onChange,
  collectionType,
}: FullnessSelectorProps) {
  const unitName = collectionType === 'bins' ? 'Bin' : 'Bucket';

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-sm font-medium text-gray-700 mb-2">
        {unitName} {index + 1} fullness:
      </p>
      <div className="flex gap-2">
        {fullnessOptions.map(option => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`flex-1 py-2 px-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              value === option.value
                ? 'bg-green-primary text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:border-green-primary'
            }`}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
