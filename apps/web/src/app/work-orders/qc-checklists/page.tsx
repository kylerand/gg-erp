'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { PageHeader, ReworkLoopBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { useRole } from '@/lib/role-context';

interface QcGate {
  id: string;
  gateLabel: string;
  isCritical: boolean;
  result: 'PASS' | 'FAIL' | 'NA' | null;
  failureNote?: string;
}

const DEFAULT_GATES: QcGate[] = [
  { id: 'g1', gateLabel: 'Brake function test — both wheels stop within 10ft at 10mph', isCritical: true, result: null },
  { id: 'g2', gateLabel: 'Battery voltage within spec (±2V of rated)', isCritical: true, result: null },
  { id: 'g3', gateLabel: 'All connectors seated and latched', isCritical: false, result: null },
  { id: 'g4', gateLabel: 'Wiring harness routed without pinch points', isCritical: false, result: null },
  { id: 'g5', gateLabel: 'Controller firmware version confirmed', isCritical: false, result: null },
  { id: 'g6', gateLabel: 'Test drive completed — 5 lap minimum', isCritical: true, result: null },
];

const RESULT_BTN_ACTIVE: Record<string, string> = {
  PASS: 'bg-green-600 text-white border-green-600',
  FAIL: 'bg-red-600 text-white border-red-600',
  NA:   'bg-gray-400 text-white border-gray-400',
};

type SubmitOutcome =
  | { status: 'PASSED' }
  | { status: 'FAILED'; openReworkCount: number; reworkLoopCount: number };

function QCChecklistsContent() {
  const params = useSearchParams();
  const taskId = params.get('taskId') ?? '';
  const workOrderId = params.get('workOrderId') ?? '';
  const { user, loading: roleLoading } = useRole();
  const reviewedBy = user?.userId ?? null;

  const [gates, setGates] = useState<QcGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [reworkLoopCount, setReworkLoopCount] = useState(0);

  const loadGates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (workOrderId) qs.set('workOrderId', workOrderId);
      if (taskId) qs.set('taskId', taskId);
      const data = await apiFetch<{ gates: QcGate[] }>(
        `/tickets/qc-gates${qs.size ? `?${qs}` : ''}`,
        undefined,
        { gates: DEFAULT_GATES },
      );
      setGates(data.gates.length > 0 ? data.gates : DEFAULT_GATES);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load QC gates');
    } finally {
      setLoading(false);
    }
  }, [taskId, workOrderId]);

  useEffect(() => { void loadGates(); }, [loadGates]);

  function setResult(id: string, result: 'PASS' | 'FAIL' | 'NA') {
    setGates(prev => prev.map(g =>
      g.id === id
        ? { ...g, result, failureNote: result !== 'FAIL' ? undefined : g.failureNote }
        : g,
    ));
  }

  function setFailureNote(id: string, note: string) {
    setGates(prev => prev.map(g => g.id === id ? { ...g, failureNote: note } : g));
  }

  const criticalPending = gates.filter(g => g.isCritical && g.result === null);
  const criticalFailMissingNote = gates.filter(g => g.isCritical && g.result === 'FAIL' && !g.failureNote?.trim());
  const canSubmit = criticalPending.length === 0 && criticalFailMissingNote.length === 0;

  async function handleSubmit() {
    if (!reviewedBy) {
      toast.error('Sign in required to submit QC');
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const results = gates.map(g => ({ gateId: g.id, result: g.result, failureNote: g.failureNote }));
      const resp = await apiFetch<{ status: string; openReworkCount?: number; activeReworkLoopCount?: number }>(
        '/tickets/qc-gates/batch-submit',
        {
          method: 'POST',
          body: JSON.stringify({ workOrderId, taskId, reviewedBy, results }),
        },
        {
          status: gates.some(g => g.isCritical && g.result === 'FAIL') ? 'FAILED' : 'PASSED',
          openReworkCount: gates.filter(g => g.result === 'FAIL').length,
          activeReworkLoopCount: 0,
        },
      );
      const loopCount = resp.activeReworkLoopCount ?? 0;
      setReworkLoopCount(loopCount);
      if (resp.status === 'PASSED') {
        setOutcome({ status: 'PASSED' });
        toast.success('QC Approved');
      } else {
        setOutcome({ status: 'FAILED', openReworkCount: resp.openReworkCount ?? 0, reworkLoopCount: loopCount });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit QC');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || roleLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="QC Checklist" description="Loading…" />
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!reviewedBy) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="QC Checklist"
          description={workOrderId ? `WO ${workOrderId}` : 'Quality Control Review'}
        />
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            Sign in to submit QC results for this work order.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="QC Checklist"
        description={workOrderId ? `WO ${workOrderId}` : 'Quality Control Review'}
      />

      {reworkLoopCount > 0 && (
        <div><ReworkLoopBadge current={reworkLoopCount} /></div>
      )}

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <span className="text-red-600 text-sm flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadGates()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {outcome?.status === 'PASSED' && (
        <Card className="border-green-400 bg-green-50">
          <CardContent className="pt-6 text-center space-y-3">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-800">QC Approved — proceed to close</p>
            <Link href="/work-orders">
              <Button variant="outline" className="min-h-[48px]">Return to My Queue</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {outcome?.status === 'FAILED' && (
        <Card className="border-red-400 bg-red-50">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">❌</span>
              <p className="font-semibold text-red-800">
                QC Failed — {outcome.openReworkCount} open rework issue{outcome.openReworkCount !== 1 ? 's' : ''}
              </p>
            </div>
            {outcome.reworkLoopCount > 0 && <ReworkLoopBadge current={outcome.reworkLoopCount} />}
            <Link href="/work-orders">
              <Button variant="outline" className="min-h-[48px]">Return to My Queue</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!outcome && (
        <>
          <div className="space-y-3">
            {gates.map(gate => (
              <Card
                key={gate.id}
                className={gate.isCritical && gate.result === 'FAIL' ? 'border-red-400' : ''}
              >
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {gate.isCritical && (
                          <span className="text-xs bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded">Critical</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-900">{gate.gateLabel}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {(['PASS', 'FAIL', 'NA'] as const).map(r => (
                        <button
                          key={r}
                          onClick={() => setResult(gate.id, r)}
                          className={`text-xs px-2.5 py-1.5 rounded font-medium border transition-colors min-h-[48px] min-w-[44px]
                            ${gate.result === r
                              ? RESULT_BTN_ACTIVE[r]
                              : 'border-gray-300 text-gray-500 hover:border-gray-400'
                            }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {gate.isCritical && gate.result === 'FAIL' && (
                    <div className="border-l-4 border-red-400 pl-3 space-y-2">
                      <p className="text-xs text-red-700 font-medium">⚠ Critical failure — note required before submit</p>
                      <Textarea
                        placeholder="Describe the failure…"
                        value={gate.failureNote ?? ''}
                        onChange={e => setFailureNote(gate.id, e.target.value)}
                        className="text-sm"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-2">
            {criticalPending.length > 0 && (
              <p className="text-xs text-amber-600">
                {criticalPending.length} critical gate{criticalPending.length > 1 ? 's' : ''} still need a result.
              </p>
            )}
            {criticalFailMissingNote.length > 0 && (
              <p className="text-xs text-red-600">
                {criticalFailMissingNote.length} critical failure{criticalFailMissingNote.length > 1 ? 's' : ''} need a failure note.
              </p>
            )}
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || submitting}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold min-h-[48px] disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit QC Sign-Off'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function QCChecklistsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl animate-pulse space-y-3 pt-4">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}
      </div>
    }>
      <QCChecklistsContent />
    </Suspense>
  );
}
