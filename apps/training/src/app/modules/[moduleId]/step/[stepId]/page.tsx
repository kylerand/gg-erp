'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Wrench,
  Package,
  Lightbulb,
  XCircle,
  Bookmark,
  BookmarkCheck,
  PlayCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import {
  getModule,
  updateStepProgress,
  toggleBookmark,
  listBookmarks,
  type TrainingModule,
  type OjtStep,
} from '@/lib/api-client';

export default function StepPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const moduleId = params.moduleId as string;
  const stepId = params.stepId as string;

  const [mod, setMod] = useState<TrainingModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    if (!moduleId) return;
    getModule(moduleId)
      .then(setMod)
      .catch(() => router.push('/modules'))
      .finally(() => setLoading(false));
  }, [moduleId, router]);

  useEffect(() => {
    if (!user || !moduleId || !stepId) return;
    listBookmarks(user.userId, moduleId).then((r) => {
      setBookmarked(r.items.some((b) => b.stepId === stepId));
    });
  }, [user, moduleId, stepId]);

  const steps = mod?.steps ?? [];
  const stepIndex = steps.findIndex((s) => s.id === stepId);
  const step: OjtStep | undefined = steps[stepIndex];
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;

  const handleComplete = useCallback(async () => {
    if (!user || !step) return;
    await updateStepProgress(moduleId, {
      employeeId: user.userId,
      stepId: step.id,
      status: 'completed',
      completed: true,
    });
    if (nextStep) {
      router.push(`/modules/${moduleId}/step/${nextStep.id}`);
    } else {
      router.push(`/modules/${moduleId}`);
    }
  }, [user, step, moduleId, nextStep, router]);

  const handleBookmark = useCallback(async () => {
    if (!user) return;
    const result = await toggleBookmark(user.userId, moduleId, stepId);
    setBookmarked(result.bookmarked);
  }, [user, moduleId, stepId]);

  if (loading || !mod || !step) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href={`/modules/${moduleId}`}
          className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          {mod.moduleName}
        </Link>
        <button onClick={handleBookmark} className="p-1" title="Bookmark this step">
          {bookmarked ? (
            <BookmarkCheck size={20} className="text-primary" />
          ) : (
            <Bookmark size={20} className="text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          Step {stepIndex + 1} of {steps.length}
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="card p-5">
        <h1 className="text-xl" data-brand-heading="true">
          {step.title}
        </h1>

        {/* Video */}
        {step.videoUrl && (
          <div className="mt-4 overflow-hidden rounded-xl bg-black">
            <video
              src={step.videoUrl}
              controls
              className="aspect-video w-full"
              poster={step.videoThumbnail}
            />
            {step.videoDuration && (
              <div className="flex items-center gap-1 bg-black/80 px-3 py-1.5 text-xs text-white/70">
                <PlayCircle size={12} /> {Math.ceil(step.videoDuration / 60)} min
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {step.instructions}
        </div>

        {/* Safety Warnings */}
        {step.safetyWarnings && step.safetyWarnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {step.safetyWarnings.map((w, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
                  w.severity === 'danger'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : w.severity === 'warning'
                      ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                      : 'border-blue-200 bg-blue-50 text-blue-800'
                }`}
              >
                {w.severity === 'danger' ? (
                  <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                )}
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tools */}
        {step.tools && step.tools.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Wrench size={13} /> Tools Needed
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {step.tools.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Materials */}
        {step.materials && step.materials.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Package size={13} /> Materials
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {step.materials.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Why It Matters */}
        {step.whyItMatters && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-blue-800">
              <Lightbulb size={13} /> Why This Matters
            </div>
            <p className="mt-1 text-xs text-blue-700">{step.whyItMatters}</p>
          </div>
        )}

        {/* Key Takeaways */}
        {step.keyTakeaways && step.keyTakeaways.length > 0 && (
          <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
            <div className="text-xs font-semibold text-green-800">Key Takeaways</div>
            <ul className="mt-1 space-y-0.5 text-xs text-green-700">
              {step.keyTakeaways.map((t, i) => (
                <li key={i}>✓ {t}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Common Mistakes */}
        {step.commonMistakes && step.commonMistakes.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-red-800">
              <XCircle size={13} /> Common Mistakes
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-700">
              {step.commonMistakes.map((m, i) => (
                <li key={i}>✗ {m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Confirmation & Navigation */}
      <div className="card p-4">
        {step.requiresConfirmation && (
          <label className="mb-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border text-primary accent-primary"
            />
            <span>I confirm I have understood and can perform this step safely.</span>
          </label>
        )}

        <div className="flex items-center gap-3">
          {prevStep && (
            <Link
              href={`/modules/${moduleId}/step/${prevStep.id}`}
              className="flex items-center gap-1 rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/30"
            >
              <ArrowLeft size={15} /> Previous
            </Link>
          )}
          <div className="flex-1" />
          <button
            onClick={handleComplete}
            disabled={step.requiresConfirmation && !confirmed}
            className="flex items-center gap-1 rounded-2xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <CheckCircle2 size={15} />
            {nextStep ? 'Complete & Next' : 'Complete Step'}
          </button>
        </div>
      </div>
    </div>
  );
}
