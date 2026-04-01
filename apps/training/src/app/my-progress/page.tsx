'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import {
  listModules,
  getModuleProgress,
  type TrainingModule,
  type ModuleProgressData,
} from '@/lib/api-client';

interface ModuleWithProgress {
  module: TrainingModule;
  progress: ModuleProgressData;
}

export default function MyProgressPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ModuleWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    listModules('ACTIVE')
      .then(async (r) => {
        const withProgress = await Promise.all(
          r.items.map(async (mod) => {
            const progress = await getModuleProgress(mod.moduleCode, user.userId);
            return { module: mod, progress };
          }),
        );
        setItems(withProgress.sort((a, b) => a.module.sortOrder - b.module.sortOrder));
      })
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const completed = items.filter((i) => i.progress.status === 'completed');
  const inProgress = items.filter(
    (i) => i.progress.status !== 'completed' && i.progress.status !== 'not-started',
  );
  const notStarted = items.filter((i) => i.progress.status === 'not-started');
  const overallPct = items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl" data-brand-heading="true">
          My Progress
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your training completion across all modules.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{completed.length}</div>
          <div className="text-xs text-muted-foreground">Completed</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-primary">{inProgress.length}</div>
          <div className="text-xs text-muted-foreground">In Progress</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-muted-foreground">{notStarted.length}</div>
          <div className="text-xs text-muted-foreground">Not Started</div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1 font-semibold">
            <TrendingUp size={15} /> Overall Progress
          </span>
          <span className="font-bold text-primary">{overallPct}%</span>
        </div>
        <div className="mt-2 h-3 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      {/* Module list */}
      <div className="space-y-2">
        {items.map(({ module: mod, progress }) => {
          const stepCount = mod.steps?.length ?? 0;
          const completedSteps = progress.steps.filter(
            (s) => s.status === 'completed' || s.completedAt,
          ).length;
          const pct = stepCount > 0 ? Math.round((completedSteps / stepCount) * 100) : 0;
          const isComplete = progress.status === 'completed';

          return (
            <Link key={mod.id} href={`/modules/${mod.moduleCode}`}>
              <div
                className={`card p-4 transition-shadow hover:shadow-md ${isComplete ? 'border-green-200 bg-green-50/30' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {isComplete ? (
                    <CheckCircle2 size={20} className="mt-0.5 flex-shrink-0 text-green-600" />
                  ) : completedSteps > 0 ? (
                    <Clock size={20} className="mt-0.5 flex-shrink-0 text-primary" />
                  ) : (
                    <Circle size={20} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{mod.moduleName}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {completedSteps}/{stepCount} steps
                      </span>
                      {mod.estimatedTime && (
                        <>
                          <span>·</span>
                          <span>{mod.estimatedTime}</span>
                        </>
                      )}
                    </div>
                    {stepCount > 0 && (
                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-primary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
