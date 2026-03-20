'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvidenceUploadSlot, PageHeader } from '@gg-erp/ui';
import type { EvidenceFile } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { useRole } from '@/lib/role-context';

interface SopStep {
  id: string;
  sequence: number;
  title: string;
  description: string;
  requiresEvidence: boolean;
  executionState: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  canStart: boolean;
  sopReference?: string;
  failedReason?: string;
}

const MOCK_STEPS: SopStep[] = [
  { id: 's1', sequence: 1, title: 'Safety Inspection', description: 'Inspect vehicle for damage, check brake condition, inspect wiring harness.', requiresEvidence: true, executionState: 'COMPLETE', canStart: true },
  { id: 's2', sequence: 2, title: 'Battery Disconnect', description: 'Disconnect main battery pack. Verify 0V across terminals with multimeter.', requiresEvidence: false, executionState: 'IN_PROGRESS', canStart: true },
  { id: 's3', sequence: 3, title: 'Motor Removal', description: 'Remove drive motor assembly. Label all connectors before disconnecting.', requiresEvidence: true, executionState: 'PENDING', canStart: false },
  { id: 's4', sequence: 4, title: 'Controller Swap', description: 'Install new controller. Verify pinout against wiring diagram.', requiresEvidence: false, executionState: 'PENDING', canStart: false },
  { id: 's5', sequence: 5, title: 'QC Sign-Off', description: 'Run QC checklist and record test results before cart leaves the floor.', requiresEvidence: true, executionState: 'PENDING', canStart: false },
];

const TTL_MS = 30 * 60 * 1000;

function lsTimerKey(taskId: string) { return `sop_timer_startedAt_${taskId}`; }
function lsStepKey(taskId: string) { return `sop_runner_${taskId}`; }

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function SOPRunnerContent() {
  const params = useSearchParams();
  const taskId = params.get('taskId') ?? '';
  const workOrderId = params.get('workOrderId') ?? '';
  const { user, loading: roleLoading } = useRole();
  const technicianId = user?.userId ?? null;

  const [steps, setSteps] = useState<SopStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failReasonMap, setFailReasonMap] = useState<Record<string, string>>({});
  const [showFailInput, setShowFailInput] = useState<Record<string, boolean>>({});
  const [evidenceMap, setEvidenceMap] = useState<Record<string, EvidenceFile[]>>({});
  const [elapsed, setElapsed] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore timer from localStorage
  useEffect(() => {
    if (!taskId) return;
    const raw = localStorage.getItem(lsTimerKey(taskId));
    if (raw) {
      const ts = parseInt(raw, 10);
      if (!isNaN(ts)) {
        setTimerStartedAt(ts);
        setElapsed(Math.floor((Date.now() - ts) / 1000));
      }
    }
  }, [taskId]);

  // Timer tick
  useEffect(() => {
    if (timerStartedAt !== null) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - timerStartedAt) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerStartedAt]);

  function startTimer() {
    const now = Date.now();
    setTimerStartedAt(now);
    if (taskId) localStorage.setItem(lsTimerKey(taskId), String(now));
  }

  const loadSteps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (workOrderId) qs.set('workOrderId', workOrderId);
      if (taskId) qs.set('taskId', taskId);
      const data = await apiFetch<{ steps: SopStep[] }>(
        `/planning/routing-steps${qs.size ? `?${qs}` : ''}`,
        undefined,
        { steps: MOCK_STEPS },
      );
      const loaded = data.steps.length > 0 ? data.steps : MOCK_STEPS;

      // Validate and discard expired localStorage save
      if (taskId) {
        const raw = localStorage.getItem(lsStepKey(taskId));
        if (raw) {
          try {
            const saved = JSON.parse(raw) as { savedAt: number };
            if (Date.now() - saved.savedAt > TTL_MS) {
              localStorage.removeItem(lsStepKey(taskId));
            }
          } catch {
            localStorage.removeItem(lsStepKey(taskId));
          }
        }
      }
      setSteps(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load steps');
    } finally {
      setLoading(false);
    }
  }, [taskId, workOrderId]);

  useEffect(() => { void loadSteps(); }, [loadSteps]);

  // Autosave active step index on each change
  useEffect(() => {
    if (!taskId || steps.length === 0) return;
    const activeIdx = steps.findIndex(
      s => s.executionState === 'IN_PROGRESS' || (s.executionState === 'PENDING' && s.canStart),
    );
    localStorage.setItem(lsStepKey(taskId), JSON.stringify({ activeIdx, savedAt: Date.now() }));
  }, [steps, taskId]);

  async function startStep(stepId: string) {
    if (!technicianId) {
      toast.error('Sign in required to start a step');
      return;
    }
    try {
      await apiFetch(
        `/planning/routing-steps/${stepId}/state`,
        { method: 'PATCH', body: JSON.stringify({ state: 'IN_PROGRESS', technicianId }) },
        {},
      );
      setSteps(prev => prev.map(s => s.id === stepId ? { ...s, executionState: 'IN_PROGRESS' } : s));
      if (timerStartedAt === null) startTimer();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start step');
    }
  }

  async function completeStep(stepId: string) {
    if (!technicianId) {
      toast.error('Sign in required to complete a step');
      return;
    }
    const step = steps.find(s => s.id === stepId);
    const files = evidenceMap[stepId] ?? [];
    const evidenceAttachmentIds = files.filter(f => f.uploadState === 'done').map(() => 'mock-attachment-id');
    try {
      await apiFetch(
        `/planning/routing-steps/${stepId}/state`,
        { method: 'PATCH', body: JSON.stringify({ state: 'COMPLETE', technicianId, evidenceAttachmentIds }) },
        {},
      );
      setSteps(prev => {
        const updated = prev.map(s => s.id === stepId ? { ...s, executionState: 'COMPLETE' as const } : s);
        const completedSeq = step?.sequence ?? 0;
        return updated.map(s =>
          s.sequence === completedSeq + 1 && s.executionState === 'PENDING' ? { ...s, canStart: true } : s,
        );
      });
      toast.success('Step completed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete step');
    }
  }

  async function failStep(stepId: string) {
    if (!technicianId) {
      toast.error('Sign in required to fail a step');
      return;
    }
    const reason = failReasonMap[stepId] ?? '';
    if (!reason.trim()) { toast.error('Enter a failure reason'); return; }
    try {
      await apiFetch(
        `/planning/routing-steps/${stepId}/state`,
        { method: 'PATCH', body: JSON.stringify({ state: 'FAILED', technicianId, failedReason: reason }) },
        {},
      );
      setSteps(prev => prev.map(s => s.id === stepId ? { ...s, executionState: 'FAILED', failedReason: reason } : s));
      setShowFailInput(prev => ({ ...prev, [stepId]: false }));
      toast.success('Step marked as failed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update step');
    }
  }

  function handleFilesSelected(stepId: string, files: File[]) {
    const newFiles: EvidenceFile[] = files.map(f => ({
      id: `${stepId}-${Date.now()}-${f.name}`,
      fileName: f.name,
      uploadState: 'uploading' as const,
      progress: 0,
    }));
    setEvidenceMap(prev => ({ ...prev, [stepId]: [...(prev[stepId] ?? []), ...newFiles] }));
    // Simulate upload: advance progress every 200ms, complete after ~1s
    newFiles.forEach(ef => {
      let prog = 0;
      const tick = setInterval(() => {
        prog += 25;
        setEvidenceMap(prev => ({
          ...prev,
          [stepId]: (prev[stepId] ?? []).map(f => f.id === ef.id ? { ...f, progress: Math.min(prog, 100) } : f),
        }));
        if (prog >= 100) {
          clearInterval(tick);
          setTimeout(() => {
            setEvidenceMap(prev => ({
              ...prev,
              [stepId]: (prev[stepId] ?? []).map(f =>
                f.id === ef.id ? { ...f, uploadState: 'done' as const, progress: 100 } : f,
              ),
            }));
          }, 200);
        }
      }, 200);
    });
  }

  function removeFile(stepId: string, fileId: string) {
    setEvidenceMap(prev => ({ ...prev, [stepId]: (prev[stepId] ?? []).filter(f => f.id !== fileId) }));
  }

  const completedCount = steps.filter(s => s.executionState === 'COMPLETE').length;
  const totalCount = steps.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allComplete = steps.length > 0 && steps.every(s => s.executionState === 'COMPLETE');

  if (!taskId) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="SOP Runner" description="Step-by-step procedure runner" />
        <Card className="mt-6">
          <CardContent className="py-10 text-center text-gray-500 text-sm">
            Select a task from My Queue to begin.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || roleLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title="SOP Runner" description="Loading…" />
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!technicianId) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="SOP Runner"
          description={`Task ${taskId}${workOrderId ? ` · WO ${workOrderId}` : ''}`}
        />
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            Sign in to run SOP steps for this work order.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="SOP Runner"
        description={`Task ${taskId}${workOrderId ? ` · WO ${workOrderId}` : ''}`}
      />

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <span className="text-red-600 text-sm flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadSteps()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Timer */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Elapsed Time</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="font-mono text-2xl text-gray-900 tabular-nums">{formatElapsed(elapsed)}</div>
          {timerStartedAt === null ? (
            <Button size="sm" onClick={startTimer} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 min-h-[48px]">
              ▶ Start Timer
            </Button>
          ) : (
            <span className="text-xs text-gray-400 italic">Running</span>
          )}
        </CardContent>
      </Card>

      {/* Progress bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">{completedCount} / {totalCount} steps complete</span>
            <span className="text-sm font-semibold text-gray-900">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-yellow-400 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map(step => {
          const isActive = step.executionState === 'IN_PROGRESS';
          const isPending = step.executionState === 'PENDING';
          const isComplete = step.executionState === 'COMPLETE';
          const isFailed = step.executionState === 'FAILED';
          const files = evidenceMap[step.id] ?? [];
          const hasEvidence = files.some(f => f.uploadState === 'done');

          return (
            <Card
              key={step.id}
              className={
                isActive ? 'border-yellow-400 shadow-sm' :
                isComplete ? 'border-green-300 bg-green-50/30' :
                isFailed ? 'border-red-300 bg-red-50/30' :
                !step.canStart ? 'opacity-60' : ''
              }
            >
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5 flex-shrink-0">
                    {isComplete ? '✅' : isFailed ? '❌' : isActive ? '🔄' : '⏳'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">Step {step.sequence}</span>
                      {step.requiresEvidence && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Evidence required</span>
                      )}
                      {step.sopReference && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{step.sopReference}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{step.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{step.description}</p>
                    {isPending && !step.canStart && (
                      <p className="text-xs text-gray-400 mt-1 italic">Waiting for prerequisite steps</p>
                    )}
                    {isFailed && step.failedReason && (
                      <p className="text-xs text-red-600 mt-1">Failure: {step.failedReason}</p>
                    )}
                  </div>
                </div>

                {isPending && step.canStart && (
                  <Button
                    size="sm"
                    onClick={() => void startStep(step.id)}
                    className="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 min-h-[48px]"
                  >
                    ▶ Start Step
                  </Button>
                )}

                {isActive && (
                  <div className="space-y-3">
                    {step.requiresEvidence && (
                      <EvidenceUploadSlot
                        label="Attach evidence photo"
                        required
                        files={files}
                        onFilesSelected={f => handleFilesSelected(step.id, f)}
                        onRemoveFile={id => removeFile(step.id, id)}
                      />
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void completeStep(step.id)}
                        disabled={step.requiresEvidence && !hasEvidence}
                        className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-gray-900 min-h-[48px] disabled:opacity-50"
                      >
                        ✓ Complete Step
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-300 hover:bg-red-50 min-h-[48px]"
                        onClick={() => setShowFailInput(prev => ({ ...prev, [step.id]: !prev[step.id] }))}
                      >
                        ✕ Mark Failed
                      </Button>
                    </div>
                    {showFailInput[step.id] && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Describe the failure reason…"
                          value={failReasonMap[step.id] ?? ''}
                          onChange={e => setFailReasonMap(prev => ({ ...prev, [step.id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void failStep(step.id)}
                          className="min-h-[48px]"
                        >
                          Confirm Failure
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Navigate to QC checklist once all steps are done */}
      {allComplete && (
        <Card className="border-green-400 bg-green-50">
          <CardContent className="pt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-green-800">All steps complete!</p>
              <p className="text-xs text-green-600 mt-0.5">Ready for quality control review.</p>
            </div>
            <Link href={`/work-orders/qc-checklists?taskId=${taskId}&workOrderId=${workOrderId}`}>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white min-h-[48px] whitespace-nowrap">
                View QC Checklist →
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function SOPRunnerPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl animate-pulse space-y-3 pt-4">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
      </div>
    }>
      <SOPRunnerContent />
    </Suspense>
  );
}
