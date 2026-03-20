import Link from 'next/link';

interface StepNavigationProps {
  moduleId: string;
  prevStepId?: string;
  nextStepId?: string;
  isLastStep: boolean;
  stepCompleted: boolean;
  onMarkComplete?: () => void | Promise<void>;
}

export function StepNavigation({
  moduleId,
  prevStepId,
  nextStepId,
  isLastStep,
  stepCompleted,
  onMarkComplete,
}: StepNavigationProps) {
  return (
    <div className="flex items-center justify-between pt-4 mt-6 border-t border-gray-200">
      {prevStepId ? (
        <Link
          href={`/training/${moduleId}/step/${prevStepId}`}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Previous
        </Link>
      ) : (
        <Link
          href={`/training/${moduleId}`}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Overview
        </Link>
      )}

      <div className="flex items-center gap-3">
        {!stepCompleted && onMarkComplete && (
          <button
            onClick={onMarkComplete}
            className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Mark Complete ✓
          </button>
        )}

        {isLastStep ? (
          <Link
            href={`/training/${moduleId}/quiz`}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-900 bg-yellow-400 rounded-lg hover:bg-yellow-500 transition-colors ${!stepCompleted ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Take Quiz →
          </Link>
        ) : nextStepId ? (
          <Link
            href={`/training/${moduleId}/step/${nextStepId}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-900 bg-yellow-400 rounded-lg hover:bg-yellow-500 transition-colors ${!stepCompleted ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Next Step →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
