interface ConsolidationProgressProps {
  assigned: number;
  total: number;
}

export function ConsolidationProgress({ assigned, total }: ConsolidationProgressProps) {
  const percentage = total > 0 ? Math.round((assigned / total) * 100) : 0;
  const isComplete = assigned === total && total > 0;

  return (
    <div className="bg-white px-4 py-3 border-b border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          {isComplete ? 'All bins/buckets assigned!' : `${assigned}/${total} bins/buckets assigned`}
        </span>
        <span
          className={`text-sm font-bold ${isComplete ? 'text-green-primary' : 'text-gray-500'}`}
        >
          {percentage}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isComplete ? 'bg-green-primary' : 'bg-lime-accent'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
