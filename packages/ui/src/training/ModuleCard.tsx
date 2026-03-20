import Link from 'next/link';

interface ModuleCardProps {
  moduleCode: string;
  moduleName: string;
  description?: string;
  estimatedTime?: string;
  stepCount: number;
  requiresSupervisorSignoff: boolean;
  status: 'not-started' | 'in-progress' | 'completed';
  completedSteps: number;
  prerequisites?: string[];
  className?: string;
}

const STATUS_STYLES = {
  'not-started': 'bg-gray-100 text-gray-600',
  'in-progress': 'bg-yellow-100 text-yellow-700',
  'completed': 'bg-green-100 text-green-700',
};

const STATUS_LABELS = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'completed': 'Completed',
};

export function ModuleCard({
  moduleCode,
  moduleName,
  description,
  estimatedTime,
  stepCount,
  requiresSupervisorSignoff,
  status,
  completedSteps,
  prerequisites,
  className,
}: ModuleCardProps) {
  const pct = stepCount > 0 ? Math.round((completedSteps / stepCount) * 100) : 0;

  return (
    <Link
      href={`/training/${moduleCode}`}
      className={`block bg-white rounded-xl border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-md transition-all ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-gray-900 leading-tight">{moduleName}</h3>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {description && (
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{description}</p>
      )}

      {status !== 'not-started' && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{completedSteps}/{stepCount} steps</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${status === 'completed' ? 'bg-green-400' : 'bg-yellow-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-400">
        {estimatedTime && <span>⏱ {estimatedTime}</span>}
        <span>📋 {stepCount} steps</span>
        {requiresSupervisorSignoff && <span>✍️ Sign-off required</span>}
        {prerequisites && prerequisites.length > 0 && (
          <span>🔗 Has prereqs</span>
        )}
      </div>
    </Link>
  );
}
