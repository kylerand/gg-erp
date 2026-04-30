import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listTrainingModules } from '@/lib/api-client';
import { erpNestedRoute } from '@/lib/erp-routes';

export default async function TrainingAdminPage() {
  const modulesResult = await listTrainingModules(undefined, { allowMockFallback: false })
    .then((data) => ({ status: 'ready' as const, modules: data.items }))
    .catch(() => ({ status: 'unavailable' as const, modules: [] }));

  return (
    <div>
      <PageHeader title="Training Admin" description="Manage modules and review trainee progress" />

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Training Modules</h2>
          {modulesResult.status === 'ready' && (
            <span className="text-sm text-gray-500">{modulesResult.modules.length} modules</span>
          )}
        </div>
        {modulesResult.status === 'unavailable' ? (
          <div className="p-5 text-sm text-red-700 bg-red-50">
            <p className="font-semibold">Training module data unavailable</p>
            <p className="mt-1">The training API did not return module administration data.</p>
          </div>
        ) : modulesResult.modules.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">No training modules configured.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {modulesResult.modules.map((m) => {
              const steps = (m.steps as unknown[] | undefined) ?? [];
              const quizCount = (m.knowledgeChecks as unknown[] | undefined)?.length ?? 0;
              return (
                <div key={m.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900 truncate">
                        {m.moduleName}
                      </span>
                      {m.requiresSupervisorSignoff && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          Sign-off
                        </span>
                      )}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          m.moduleStatus === 'ACTIVE'
                            ? 'bg-green-100 text-green-700'
                            : m.moduleStatus === 'INACTIVE'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {m.moduleStatus}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 font-mono">{m.moduleCode}</div>
                  </div>
                  <div className="text-xs text-gray-500 text-right">
                    <div>{steps.length} steps</div>
                    <div>{quizCount} quiz questions</div>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={erpNestedRoute('training', m.moduleCode)}
                      className="text-xs px-2.5 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded transition-colors"
                    >
                      Preview
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
