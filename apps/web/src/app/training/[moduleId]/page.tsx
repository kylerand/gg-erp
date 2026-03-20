import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTrainingModule } from '@/lib/api-client';

interface Props {
  params: Promise<{ moduleId: string }>;
}

export default async function ModuleOverviewPage({ params }: Props) {
  const { moduleId } = await params;

  let module;
  try {
    module = await getTrainingModule(moduleId);
  } catch {
    notFound();
  }

  const steps = (module.steps as { id: string; title: string; videoDuration?: number; requiresConfirmation?: boolean; requiresVideoCompletion?: boolean }[] | undefined) ?? [];
  const totalDuration = steps.reduce((acc, s) => acc + (s.videoDuration ?? 0), 0);
  const durationMins = Math.ceil(totalDuration / 60);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/training" className="text-sm text-gray-500 hover:text-yellow-600">
          ← Back to Training
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        {module.thumbnailUrl && (
          <div className="h-48 bg-gray-900 overflow-hidden">
            <img src={module.thumbnailUrl} alt={module.moduleName} className="w-full h-full object-cover opacity-80" />
          </div>
        )}
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">{module.moduleCode}</span>
              <h1 className="text-2xl font-bold text-gray-900 mt-1">{module.moduleName}</h1>
              {module.description && <p className="text-gray-600 mt-2 text-sm leading-relaxed">{module.description}</p>}
            </div>
            {module.requiresSupervisorSignoff && (
              <span className="flex-shrink-0 bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-1 rounded-full">
                Supervisor Sign-off Required
              </span>
            )}
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
            <span>⏱ {module.estimatedTime ?? `${durationMins} min`}</span>
            <span>📚 {steps.length} steps</span>
            {module.passScore && <span>🎯 Pass score: {module.passScore}%</span>}
            {module.jobRoles?.length > 0 && <span>👤 {module.jobRoles.join(', ')}</span>}
          </div>

          {/* Prerequisites */}
          {module.prerequisites?.length > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <strong>Prerequisites:</strong> {module.prerequisites.join(', ')}
            </div>
          )}

          {/* CTA */}
          <div className="mt-6">
            <Link
              href={steps[0] ? `/training/${moduleId}/step/${steps[0].id}` : '#'}
              className="inline-flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              Start Module →
            </Link>
          </div>
        </div>
      </div>

      {/* Steps list */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Module Steps</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {steps.map((step, idx) => (
            <Link
              key={step.id}
              href={`/training/${moduleId}/step/${step.id}`}
              className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors"
            >
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">
                {idx + 1}
              </span>
              <span className="flex-1 text-sm text-gray-800">{step.title}</span>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {step.requiresVideoCompletion && <span title="Video required">🎬</span>}
                {step.requiresConfirmation && <span title="Confirmation required">✅</span>}
                {step.videoDuration && <span>{Math.ceil(step.videoDuration / 60)}m</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
