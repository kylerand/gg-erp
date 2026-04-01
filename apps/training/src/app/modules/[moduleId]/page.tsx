'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  Users,
  ShieldAlert,
  CheckCircle2,
  Circle,
  PlayCircle,
  FileQuestion,
  Star,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import {
  getModule,
  getModuleProgress,
  type TrainingModule,
  type ModuleProgressData,
} from '@/lib/api-client';

export default function ModuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const moduleId = params.moduleId as string;
  const [mod, setMod] = useState<TrainingModule | null>(null);
  const [progress, setProgress] = useState<ModuleProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!moduleId) return;
    Promise.all([
      getModule(moduleId),
      user ? getModuleProgress(moduleId, user.userId) : null,
    ])
      .then(([m, p]) => {
        setMod(m);
        if (p) setProgress(p);
      })
      .catch(() => router.push('/modules'))
      .finally(() => setLoading(false));
  }, [moduleId, user, router]);

  if (loading || !mod) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const steps = mod.steps ?? [];
  const checks = mod.knowledgeChecks ?? [];
  const completedStepIds = new Set(
    progress?.steps.filter((s) => s.status === 'completed' || s.completedAt).map((s) => s.stepId) ?? [],
  );
  const quizPassed = progress?.quizAttempts.some((a) => a.passed) ?? false;
  const allStepsComplete = steps.length > 0 && steps.every((s) => completedStepIds.has(s.id));

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/modules')}
        className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} />
        All Modules
      </button>

      <div className="card p-5">
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-xl" data-brand-heading="true">
            {mod.moduleName}
          </h1>
          {mod.isRequired && (
            <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              Required
            </span>
          )}
        </div>

        {mod.description && (
          <p className="mt-2 text-sm text-muted-foreground">{mod.description}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {mod.estimatedTime && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
              <Clock size={13} /> {mod.estimatedTime}
            </span>
          )}
          {mod.jobRoles.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
              <Users size={13} /> {mod.jobRoles.join(', ')}
            </span>
          )}
          {mod.requiresSupervisorSignoff && (
            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-orange-700">
              <Star size={13} /> Supervisor sign-off required
            </span>
          )}
          {mod.passScore && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
              <FileQuestion size={13} /> Pass score: {mod.passScore}%
            </span>
          )}
        </div>

        {mod.prerequisites.length > 0 && (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-yellow-800">
              <ShieldAlert size={14} />
              Prerequisites
            </div>
            <ul className="mt-1 text-xs text-yellow-700">
              {mod.prerequisites.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Steps list */}
      <div>
        <h2 className="mb-3 text-lg font-semibold" data-brand-heading="true">
          Steps ({steps.length})
        </h2>
        <div className="space-y-2">
          {steps.map((step, i) => {
            const done = completedStepIds.has(step.id);
            return (
              <Link key={step.id} href={`/modules/${moduleId}/step/${step.id}`}>
                <div
                  className={`card flex items-center gap-3 p-4 transition-shadow hover:shadow-md ${done ? 'border-green-200 bg-green-50/40' : ''}`}
                >
                  {done ? (
                    <CheckCircle2 size={22} className="flex-shrink-0 text-green-600" />
                  ) : (
                    <Circle size={22} className="flex-shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-medium text-foreground">{step.title}</span>
                    </div>
                    {step.videoUrl && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <PlayCircle size={12} /> Video included
                        {step.videoDuration && ` · ${Math.ceil(step.videoDuration / 60)} min`}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Quiz section */}
      {checks.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold" data-brand-heading="true">
            Knowledge Check
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {checks.length} question{checks.length !== 1 ? 's' : ''} ·{' '}
            {mod.passScore ?? 80}% to pass
          </p>
          {quizPassed ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
              <CheckCircle2 size={18} /> Quiz Passed!
            </div>
          ) : (
            <Link
              href={`/modules/${moduleId}/quiz`}
              className={`mt-3 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white transition-colors ${
                allStepsComplete
                  ? 'bg-primary hover:bg-primary/90'
                  : 'cursor-not-allowed bg-muted-foreground/40'
              }`}
              onClick={(e) => {
                if (!allStepsComplete) e.preventDefault();
              }}
            >
              <FileQuestion size={16} />
              {allStepsComplete ? 'Take Quiz' : 'Complete all steps first'}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
