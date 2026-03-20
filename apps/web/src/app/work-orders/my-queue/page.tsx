'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import {
  listTechnicianTasks,
  transitionTechnicianTask,
  type TechnicianTask,
  type BlockedReasonCode,
} from '@/lib/api-client';
import { useRole } from '@/lib/role-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const ACTIVE_STATES: TechnicianTask['state'][] = ['READY', 'IN_PROGRESS', 'BLOCKED'];

const BLOCK_REASON_OPTIONS: { value: BlockedReasonCode; label: string }[] = [
  { value: 'WAITING_PARTS', label: 'Waiting on Parts' },
  { value: 'WAITING_MANAGER', label: 'Waiting on Manager' },
  { value: 'TOOLING_ISSUE', label: 'Tooling Issue' },
  { value: 'CUSTOMER_HOLD', label: 'Customer Hold' },
  { value: 'SAFETY_CONCERN', label: 'Safety Concern' },
  { value: 'OTHER', label: 'Other' },
];

function formatAge(iso?: string): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MyQueuePage() {
  const router = useRouter();
  const { user, loading: roleLoading } = useRole();
  const technicianId = user?.userId ?? null;

  const [tasks, setTasks] = useState<TechnicianTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [blockDialogTaskId, setBlockDialogTaskId] = useState<string | null>(null);
  const [blockReasonCode, setBlockReasonCode] = useState<BlockedReasonCode>('WAITING_PARTS');
  const [blockReasonText, setBlockReasonText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const lastFetchedAtRef = useRef<Date | null>(null);

  const load = useCallback(async () => {
    if (!technicianId) return;
    try {
      const { items } = await listTechnicianTasks({ technicianId, limit: 20 });
      setTasks(items);
      lastFetchedAtRef.current = new Date();
      setIsStale(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [technicianId]);

  useEffect(() => {
    if (roleLoading) return;
    if (!technicianId) { setLoading(false); return; }
    setLoading(true);
    void load();
    const pollInterval = setInterval(() => void load(), 30_000);
    const staleInterval = setInterval(() => {
      if (lastFetchedAtRef.current) {
        const ageMins = (Date.now() - lastFetchedAtRef.current.getTime()) / 60_000;
        setIsStale(ageMins > 2);
      }
    }, 15_000);
    return () => {
      clearInterval(pollInterval);
      clearInterval(staleInterval);
    };
  }, [technicianId, roleLoading, load]);

  async function handleTransition(task: TechnicianTask, nextState: TechnicianTask['state']) {
    const prevTask = { ...task };
    setTransitioning(task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, state: nextState } : t));
    try {
      const updated = await transitionTechnicianTask(task.id, nextState);
      setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
      toast.success(`Task moved to ${nextState.replace(/_/g, ' ').toLowerCase()}`);
    } catch (err) {
      setTasks(prev => prev.map(t => t.id === task.id ? prevTask : t));
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setTransitioning(null);
    }
  }

  async function handleBlock(taskId: string) {
    if (blockReasonCode === 'OTHER' && !blockReasonText.trim()) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const prevTask = { ...task };
    const reasonLabel = BLOCK_REASON_OPTIONS.find(r => r.value === blockReasonCode)?.label ?? blockReasonCode;
    const optimisticTask: TechnicianTask = {
      ...task,
      state: 'BLOCKED',
      blockedReasonCode: blockReasonCode,
      blockedReason: blockReasonText.trim() || reasonLabel,
    };
    setBlockDialogTaskId(null);
    setTransitioning(taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? optimisticTask : t));
    try {
      const result = await transitionTechnicianTask(taskId, 'BLOCKED', {
        blockedReason: blockReasonText.trim() || reasonLabel,
        blockedReasonCode: blockReasonCode,
      });
      setTasks(prev => prev.map(t => t.id === taskId ? result : t));
      toast.success('Task blocked');
    } catch (err) {
      setTasks(prev => prev.map(t => t.id === taskId ? prevTask : t));
      setError(err instanceof Error ? err.message : 'Failed to block task');
    } finally {
      setTransitioning(null);
      setBlockReasonText('');
      setBlockReasonCode('WAITING_PARTS');
    }
  }

  const activeTasks = tasks.filter(t => ACTIVE_STATES.includes(t.state));
  const doneTasks = tasks.filter(t => t.state === 'DONE' || t.state === 'CANCELLED');
  const blockDialogTask = tasks.find(t => t.id === blockDialogTaskId);

  if (loading || roleLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="My Queue" />
        <LoadingSkeleton rows={6} cols={4} />
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="My Queue" />
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center" role="alert">
          <p className="text-red-700 text-sm font-medium">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); void load(); }}
            className="mt-3 text-xs text-red-600 underline"
            aria-label="Retry loading queue"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Page header + stale/error banners */}
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="My Queue" description="Work assigned to you" />
        <div className="flex flex-col items-end gap-2 pt-1">
          {isStale && (
            <div
              className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700"
              role="alert"
              aria-live="polite"
            >
              <span aria-hidden="true">⚠</span>
              <span>Data may be stale</span>
              <button
                onClick={() => { setLoading(true); void load(); }}
                className="font-semibold underline"
                aria-label="Refresh task list"
              >
                Refresh
              </button>
            </div>
          )}
          {error && tasks.length > 0 && (
            <div
              className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700"
              role="alert"
            >
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="font-semibold underline"
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {activeTasks.length === 0 && doneTasks.length === 0 ? (
        <EmptyState
          icon="🛠"
          title="No assigned work"
          description="No work currently assigned to you — check with your dispatcher."
          action={
            <Button
              onClick={() => { setLoading(true); void load(); }}
              variant="outline"
              size="sm"
              aria-label="Refresh task list"
            >
              Refresh
            </Button>
          }
        />
      ) : (
        <>
          {/* Active tasks */}
          {activeTasks.length > 0 && (
            <div className="space-y-3">
              {activeTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busy={transitioning === task.id}
                  onStart={() => void handleTransition(task, 'IN_PROGRESS')}
                  onBlock={() => {
                    setBlockReasonCode('WAITING_PARTS');
                    setBlockReasonText('');
                    setBlockDialogTaskId(task.id);
                  }}
                  onComplete={() => void handleTransition(task, 'DONE')}
                  onUnblock={() => void handleTransition(task, 'IN_PROGRESS')}
                  onSop={() => router.push(`/work-orders/sop-runner?taskId=${task.id}`)}
                />
              ))}
            </div>
          )}

          {/* Done / Cancelled tasks — collapsed by default */}
          {doneTasks.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowDone(v => !v)}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1 mb-2"
                aria-expanded={showDone}
                aria-label={showDone ? 'Collapse completed tasks' : 'Show completed tasks'}
              >
                <span aria-hidden="true">{showDone ? '▾' : '▸'}</span>
                {doneTasks.length} completed / cancelled
              </button>
              {showDone && (
                <div className="space-y-2 opacity-60">
                  {doneTasks.map(task => (
                    <TaskCard key={task.id} task={task} busy={false} readOnly />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Block dialog */}
      <Dialog
        open={!!blockDialogTaskId}
        onOpenChange={(open: boolean) => { if (!open) setBlockDialogTaskId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block Task</DialogTitle>
          </DialogHeader>
          {blockDialogTask && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-600">
                Task:{' '}
                <span className="font-medium">
                  {blockDialogTask.routingStepTitle ?? `Step ${blockDialogTask.routingStepId}`}
                </span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="block-reason-code">Reason</Label>
                <Select
                  value={blockReasonCode}
                  onValueChange={(v) => { if (v) setBlockReasonCode(v as BlockedReasonCode); }}
                >
                  <SelectTrigger id="block-reason-code" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCK_REASON_OPTIONS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="block-reason-text">
                  Notes{blockReasonCode === 'OTHER' ? ' (required)' : ' (optional)'}
                </Label>
                <Textarea
                  id="block-reason-text"
                  value={blockReasonText}
                  onChange={e => setBlockReasonText(e.target.value)}
                  placeholder="Describe the issue…"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogTaskId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={blockReasonCode === 'OTHER' && !blockReasonText.trim()}
              onClick={() => { if (blockDialogTaskId) void handleBlock(blockDialogTaskId); }}
              aria-label="Confirm block task"
            >
              Mark Blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── TaskCard sub-component ───────────────────────────────────────────────────

interface TaskCardProps {
  task: TechnicianTask;
  busy: boolean;
  readOnly?: boolean;
  onStart?: () => void;
  onBlock?: () => void;
  onComplete?: () => void;
  onUnblock?: () => void;
  onSop?: () => void;
}

function TaskCard({
  task,
  busy,
  readOnly = false,
  onStart,
  onBlock,
  onComplete,
  onUnblock,
  onSop,
}: TaskCardProps) {
  const ageStr = formatAge(task.startedAt ?? task.createdAt);
  const isBlocked = task.state === 'BLOCKED';
  const isInProgress = task.state === 'IN_PROGRESS';
  const isReady = task.state === 'READY';
  const showSop = (isReady || isInProgress) && !readOnly;
  const blockedReasonLabel =
    task.blockedReason ??
    (task.blockedReasonCode
      ? (BLOCK_REASON_OPTIONS.find(r => r.value === task.blockedReasonCode)?.label ?? task.blockedReasonCode)
      : null);

  return (
    <div
      className={`bg-white rounded-lg border p-4 transition-colors ${
        isBlocked ? 'border-red-200 bg-red-50/20' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Header: WO number, state badge, age, estimated time */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {task.workOrderNumber && (
              <span className="font-mono text-xs text-gray-500">{task.workOrderNumber}</span>
            )}
            <StatusBadge status={task.state} />
            {ageStr && (
              <span className="text-xs text-gray-400" aria-label={`Age: ${ageStr}`}>
                {ageStr}
              </span>
            )}
            {task.estimatedMinutes != null && (
              <span className="text-xs text-gray-400">~{task.estimatedMinutes}m</span>
            )}
          </div>

          {/* Routing step title */}
          <p className="text-sm font-medium text-gray-900">
            {task.routingStepTitle ?? `Step ${task.routingStepId}`}
          </p>

          {/* Blocked reason — text, not color-only */}
          {isBlocked && blockedReasonLabel && (
            <div className="mt-1.5 flex items-start gap-1.5" role="alert">
              <span className="text-amber-600 text-xs font-semibold shrink-0" aria-hidden="true">
                ⚠ Blocked:
              </span>
              <span className="text-xs text-amber-800">{blockedReasonLabel}</span>
            </div>
          )}

          {/* Required skill tags */}
          {task.requiredSkillCodes && task.requiredSkillCodes.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1.5" aria-label="Required skills">
              {task.requiredSkillCodes.map(code => (
                <span
                  key={code}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200"
                >
                  {code}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        {!readOnly && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {busy && (
              <span className="text-xs text-gray-400 animate-pulse w-5 text-center" aria-label="Processing">
                …
              </span>
            )}

            {isReady && (
              <Button
                disabled={busy}
                onClick={onStart}
                aria-label="Start task"
                className="min-h-[48px] min-w-[48px] bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold border-0"
              >
                Start
              </Button>
            )}

            {isInProgress && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={onBlock}
                  aria-label="Block task — mark as blocked"
                  className="min-h-[48px] min-w-[48px]"
                >
                  Block
                </Button>
                <Button
                  disabled={busy}
                  onClick={onComplete}
                  aria-label="Complete task"
                  className="min-h-[48px] min-w-[48px] bg-green-600 hover:bg-green-500 text-white border-0"
                >
                  Complete
                </Button>
              </>
            )}

            {isBlocked && (
              <Button
                disabled={busy}
                onClick={onUnblock}
                aria-label="Unblock task — resume in progress"
                className="min-h-[48px] min-w-[48px] bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold border-0"
              >
                Unblock
              </Button>
            )}

            {showSop && (
              <Button
                variant="outline"
                disabled={!task.routingStepId}
                onClick={task.routingStepId ? onSop : undefined}
                aria-label={
                  task.routingStepId ? 'Open SOP instructions' : 'No SOP assigned to this step'
                }
                title={!task.routingStepId ? 'No SOP assigned' : undefined}
                className="min-h-[48px] min-w-[48px]"
              >
                SOP ↗
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
