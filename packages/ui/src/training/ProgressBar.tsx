interface ProgressBarProps {
  completed: number;
  total: number;
  label?: string;
  className?: string;
}

export function TrainingProgressBar({ completed, total, label, className }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className={className}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-600">{label ?? 'Progress'}</span>
        <span className="text-sm font-semibold text-gray-800">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className="bg-yellow-400 h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">{completed} of {total} steps completed</p>
    </div>
  );
}
