import { PageHeader, ModuleCard } from '@gg-erp/ui';
import { listTrainingModules } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';

export default async function TrainingPage() {
  const modulesResult = await listTrainingModules(
    { status: 'ACTIVE' },
    { allowMockFallback: false },
  )
    .then((data) => ({ status: 'ready' as const, modules: data.items }))
    .catch(() => ({ status: 'unavailable' as const, modules: [] }));

  return (
    <div>
      <PageHeader
        title="Training"
        description="On-the-job training modules for golf cart assembly technicians"
      />

      {/* Quick nav */}
      <WorkspaceLinkGrid moduleKey="training" variant="pills" />

      {/* Module grid */}
      {modulesResult.status === 'unavailable' ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Training data unavailable</p>
          <p className="mt-1">The training API did not return active modules.</p>
        </div>
      ) : modulesResult.modules.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">🎓</div>
          <p className="text-sm">No active training modules found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modulesResult.modules.map((m) => (
            <ModuleCard
              key={m.id}
              moduleCode={m.moduleCode}
              moduleName={m.moduleName}
              description={m.description}
              estimatedTime={m.estimatedTime}
              stepCount={(m.steps as unknown[] | undefined)?.length ?? 0}
              requiresSupervisorSignoff={m.requiresSupervisorSignoff}
              status="not-started"
              completedSteps={0}
              prerequisites={m.prerequisites}
            />
          ))}
        </div>
      )}
    </div>
  );
}
