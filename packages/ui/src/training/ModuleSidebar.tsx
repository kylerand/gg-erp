import Link from 'next/link';

interface OjtStep {
  id: string;
  title: string;
}

interface ModuleSidebarProps {
  moduleId: string;
  moduleName?: string;
  steps: OjtStep[];
  currentStepId: string;
  completedStepIds: string[] | Set<string>;
}

export function ModuleSidebar({ moduleId, moduleName, steps, currentStepId, completedStepIds }: ModuleSidebarProps) {
  const isDone = (id: string) =>
    Array.isArray(completedStepIds) ? completedStepIds.includes(id) : completedStepIds.has(id);

  return (
    <nav className="bg-white rounded-lg border border-gray-200 overflow-hidden sticky top-4">
      {moduleName && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <Link href={`/training/${moduleId}`} className="text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-yellow-600 transition-colors">
            {moduleName}
          </Link>
        </div>
      )}
      <ul className="divide-y divide-gray-100 max-h-[calc(100vh-8rem)] overflow-y-auto">
        {steps.map((step, i) => {
          const isCompleted = isDone(step.id);
          const isCurrent = step.id === currentStepId;
          return (
            <li key={step.id}>
              <Link
                href={`/training/${moduleId}/step/${step.id}`}
                className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors
                  ${isCurrent ? 'bg-yellow-50 border-l-2 border-yellow-400' : 'hover:bg-gray-50'}
                  ${isCompleted && !isCurrent ? 'text-gray-500' : 'text-gray-900'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                  ${isCompleted ? 'bg-green-100 text-green-700' : isCurrent ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {isCompleted ? '✓' : i + 1}
                </span>
                <span className={`flex-1 leading-tight ${isCurrent ? 'font-semibold' : ''}`}>{step.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
