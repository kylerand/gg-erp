'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  VideoPlayer,
  SafetyWarning,
  ResourcesPanel,
  KeyTakeaways,
  ModuleSidebar,
  StepNavigation,
  NotesPanel,
  BookmarkButton,
} from '@gg-erp/ui';
import {
  getTrainingModule,
  getModuleProgress,
  updateStepProgress,
  listNotes,
  toggleBookmark,
  listBookmarks,
  saveNote,
  type TrainingModule,
  type OjtStep,
  type ModuleProgressData,
  type OjtNote,
} from '@/lib/api-client';
import { erpNestedRoute, erpRoute } from '@/lib/erp-routes';
import { useRole } from '@/lib/role-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function emptyProgress(moduleId: string, employeeId: string): ModuleProgressData {
  return {
    moduleId,
    employeeId,
    status: 'not-started',
    currentStep: null,
    startedAt: null,
    completedAt: null,
    steps: [],
    quizAttempts: [],
  };
}

export default function StepPage() {
  const params = useParams<{ moduleId: string; stepId: string }>();
  const { moduleId, stepId } = params;
  const { user } = useRole();
  const employeeId = user?.userId ?? '';
  const canTrackProgress = UUID_RE.test(employeeId);

  const [module, setModule] = useState<TrainingModule | null>(null);
  const [progress, setProgress] = useState<ModuleProgressData | null>(null);
  const [notes, setNotes] = useState<OjtNote[]>([]);
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const [savingBookmark, setSavingBookmark] = useState(false);

  const steps = (module?.steps as OjtStep[] | undefined) ?? [];
  const stepIndex = steps.findIndex((s) => s.id === stepId);
  const step = steps[stepIndex] ?? null;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;
  const isLastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setTrackingWarning(null);
        const mod = await getTrainingModule(moduleId, { allowMockFallback: false });
        const [progressResult, notesResult, bookmarksResult] = await Promise.allSettled([
          canTrackProgress
            ? getModuleProgress(mod.id, employeeId, { allowMockFallback: false })
            : Promise.resolve(emptyProgress(mod.id, employeeId)),
          canTrackProgress
            ? listNotes(employeeId, mod.id, { allowMockFallback: false })
            : Promise.resolve([]),
          canTrackProgress
            ? listBookmarks(employeeId, mod.id, { allowMockFallback: false })
            : Promise.resolve([]),
        ]);

        const prog =
          progressResult.status === 'fulfilled'
            ? progressResult.value
            : emptyProgress(mod.id, employeeId);
        const notesList = notesResult.status === 'fulfilled' ? notesResult.value : [];
        const bookmarksList = bookmarksResult.status === 'fulfilled' ? bookmarksResult.value : [];

        if (!cancelled) {
          setModule(mod);
          setProgress(prog);
          setNotes(notesList.filter((n) => n.stepId === stepId));
          setBookmarked(bookmarksList.some((b) => b.stepId === stepId));
          if (!canTrackProgress) {
            setTrackingWarning('Progress tools are unavailable for this signed-in user.');
          } else if (
            progressResult.status === 'rejected' ||
            notesResult.status === 'rejected' ||
            bookmarksResult.status === 'rejected'
          ) {
            setTrackingWarning(
              'Progress tools did not load. Lesson content is still available.',
            );
          }
        }
      } catch (err) {
        console.error('Error loading step', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [canTrackProgress, employeeId, moduleId, stepId]);

  const stepStatus = progress?.steps.find((s) => s.stepId === stepId);
  const completedStepIds = new Set(
    progress?.steps.filter((s) => s.status === 'completed').map((s) => s.stepId) ?? [],
  );

  function handleVideoProgress(pct: number) {
    if (!canTrackProgress) return;
    updateStepProgress(
      module?.id ?? moduleId,
      {
        employeeId: employeeId,
        stepId,
        videoProgress: pct,
      },
      { allowMockFallback: false },
    ).catch(() => {});
  }

  function handleVideoComplete() {
    if (!canTrackProgress) return;
    updateStepProgress(
      module?.id ?? moduleId,
      {
        employeeId: employeeId,
        stepId,
        videoWatched: true,
        videoProgress: 100,
      },
      { allowMockFallback: false },
    ).catch(() => {});
  }

  async function handleMarkComplete() {
    if (!module || !canTrackProgress) return;
    try {
      await updateStepProgress(
        module.id,
        {
          employeeId: employeeId,
          stepId,
          status: 'completed',
          completed: true,
        },
        { allowMockFallback: false },
      );
      const updated = await getModuleProgress(module.id, employeeId, {
        allowMockFallback: false,
      });
      setProgress(updated);
      setTrackingWarning(null);
    } catch {
      setTrackingWarning('Step completion could not be saved.');
    }
  }

  async function handleBookmarkToggle() {
    if (!module || !canTrackProgress) return;
    setSavingBookmark(true);
    try {
      const next = await toggleBookmark(employeeId, module.id, stepId, {
        allowMockFallback: false,
      });
      setBookmarked(next);
      setTrackingWarning(null);
    } catch {
      setTrackingWarning('Bookmark could not be saved.');
    } finally {
      setSavingBookmark(false);
    }
  }

  async function handleSaveNote(content: string) {
    if (!module || !canTrackProgress) return;
    try {
      await saveNote(employeeId, module.id, content, stepId, {
        allowMockFallback: false,
      });
      const updatedNotes = await listNotes(employeeId, module.id, {
        allowMockFallback: false,
      });
      setNotes(updatedNotes.filter((n) => n.stepId === stepId));
      setTrackingWarning(null);
    } catch (error) {
      setTrackingWarning('Notes could not be saved.');
      throw error;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <div className="text-sm">Loading step…</div>
      </div>
    );
  }

  if (!module || !step) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p>Step not found.</p>
        <Link
          href={erpNestedRoute('training', moduleId)}
          className="text-yellow-600 hover:underline text-sm"
        >
          Back to module
        </Link>
      </div>
    );
  }

  return (
    <div className="flex gap-6 max-w-7xl mx-auto">
      {/* Sidebar */}
      <div className="hidden lg:block w-64 flex-shrink-0">
        <ModuleSidebar
          moduleId={moduleId}
          moduleName={module.moduleName}
          steps={steps}
          currentStepId={stepId}
          completedStepIds={completedStepIds}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <nav className="text-xs text-gray-500 mb-4 flex items-center gap-1.5">
          <Link href={erpRoute('training')} className="hover:text-yellow-600">
            Training
          </Link>
          <span>/</span>
          <Link href={erpNestedRoute('training', moduleId)} className="hover:text-yellow-600">
            {module.moduleName}
          </Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">{step.title}</span>
        </nav>

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{step.title}</h1>
          <BookmarkButton
            isBookmarked={bookmarked}
            onToggle={handleBookmarkToggle}
            loading={!canTrackProgress || savingBookmark}
          />
        </div>

        {trackingWarning && (
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
            {trackingWarning}
          </div>
        )}

        {/* Safety warnings */}
        {(step.safetyWarnings?.length ?? 0) > 0 && (
          <SafetyWarning warnings={step.safetyWarnings ?? []} />
        )}

        {/* Video */}
        {step.videoUrl && (
          <div className="mb-6">
            <VideoPlayer
              videoUrl={step.videoUrl}
              onProgress={handleVideoProgress}
              onComplete={handleVideoComplete}
            />
          </div>
        )}

        {/* Instructions */}
        {step.instructions && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h2 className="font-semibold text-gray-800 mb-3">Instructions</h2>
            <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
              {step.instructions}
            </div>
          </div>
        )}

        {/* Resources */}
        {((step.tools?.length ?? 0) > 0 || (step.materials?.length ?? 0) > 0) && (
          <ResourcesPanel tools={step.tools ?? []} materials={step.materials ?? []} />
        )}

        {/* Key takeaways */}
        {(step.whyItMatters || (step.commonMistakes?.length ?? 0) > 0) && (
          <KeyTakeaways whyItMatters={step.whyItMatters} commonMistakes={step.commonMistakes} />
        )}

        {/* Notes */}
        <NotesPanel
          employeeId={employeeId}
          moduleId={module.id}
          stepId={stepId}
          initialNotes={notes}
          onSave={canTrackProgress ? handleSaveNote : undefined}
        />

        {/* Navigation */}
        <StepNavigation
          moduleId={moduleId}
          prevStepId={prevStep?.id}
          nextStepId={nextStep?.id}
          isLastStep={isLastStep}
          stepCompleted={!canTrackProgress || stepStatus?.status === 'completed'}
          onMarkComplete={canTrackProgress ? handleMarkComplete : undefined}
        />
      </div>
    </div>
  );
}
