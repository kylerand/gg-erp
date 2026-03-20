import Link from 'next/link';
import { PageHeader, ModuleCard } from '@gg-erp/ui';
import { listTrainingModules } from '@/lib/api-client';

export default async function TrainingPage() {
  const { items: modules } = await listTrainingModules({ status: 'ACTIVE' });

  return (
    <div>
      <PageHeader
        title="Training"
        description="On-the-job training modules for golf cart assembly technicians"
      />

      {/* Quick nav */}
      <div className="flex gap-3 mb-6">
        {[
          { label: 'Team Assignments', href: '/training/assignments', icon: '📋' },
          { label: 'SOP Library', href: '/training/sop', icon: '📖' },
          { label: 'Admin', href: '/training/admin', icon: '⚙️' },
        ].map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-yellow-400 hover:text-gray-900 transition-colors"
          >
            {item.icon} {item.label}
          </Link>
        ))}
      </div>

      {/* Module grid */}
      {modules.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">🎓</div>
          <p className="text-sm">No training modules found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map(m => (
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

