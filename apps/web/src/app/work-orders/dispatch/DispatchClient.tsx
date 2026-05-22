'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CheckCircle2, ExternalLink, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  apiFetch,
  listEmployees,
  listScheduleAssignments,
  listTechnicianTasks,
  mutationHeaders,
  transitionWoOperation,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import type {
  Employee,
  ScheduleAssignment,
  TechnicianTask,
  WoOperationStatus,
} from '@/lib/api-client';

const REFRESH_INTERVAL = 30_000;
const STALE_THRESHOLD = 2 * 60_000;

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const DISPATCH_ASSIGNMENT_STATES = new Set(['PUBLISHED', 'DISPATCHED']);
const TERMINAL_OPERATION_STATUSES = new Set(['DONE', 'SKIPPED', 'CANCELLED']);

interface DispatchWeek {
  start: string;
  end: string;
}

function getDispatchWeekDates(base = new Date()): DispatchWeek {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  return { start: formatDateKey(start), end: formatDateKey(end) };
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatAge(ts: string): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function missingSkills(tech: Employee, required: string[]): string[] {
  const techSkills = tech.skills ?? [];
  return required.filter((s) => !techSkills.includes(s));
}

function TaskCard({
  task,
  showReassign,
  isBusy,
  onAssign,
}: {
  task: TechnicianTask;
  showReassign?: boolean;
  isBusy: boolean;
  onAssign: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-gray-500">
            {task.workOrderNumber ?? task.workOrderId}
          </div>
          <div className="text-sm font-medium text-gray-900 mt-0.5 truncate">
            {task.routingStepTitle ?? task.routingStepId}
          </div>
        </div>
        <StatusBadge status={task.state} />
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
        {task.createdAt && <span>{formatAge(task.createdAt)}</span>}
        {task.estimatedMinutes && <span>~{task.estimatedMinutes}min</span>}
        {isBusy && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-medium">
            ⚠ Busy
          </span>
        )}
      </div>

      {(task.requiredSkillCodes?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.requiredSkillCodes!.map((skill) => (
            <span key={skill} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {skill}
            </span>
          ))}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onAssign}
        className="w-full min-h-[48px] text-xs"
      >
        {showReassign ? '↻ Reassign' : '+ Assign'}
      </Button>
    </div>
  );
}

export function DispatchClient() {
  const [dispatchWeek] = useState(() => getDispatchWeekDates());
  const [scheduleAssignments, setScheduleAssignments] = useState<ScheduleAssignment[]>([]);
  const [unassigned, setUnassigned] = useState<TechnicianTask[]>([]);
  const [techTasks, setTechTasks] = useState<Record<string, TechnicianTask[]>>({});
  const [activeTechs, setActiveTechs] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastRefreshDisplay, setLastRefreshDisplay] = useState<number>(Date.now());
  const lastRefreshRef = useRef<number>(Date.now());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TechnicianTask | null>(null);
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [operationActionId, setOperationActionId] = useState<string | null>(null);
  const [blockingAssignment, setBlockingAssignment] = useState<ScheduleAssignment | null>(null);
  const [blockingReason, setBlockingReason] = useState('');

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [employeeData, scheduleData] = await Promise.all([
        listEmployees({ employmentState: 'ACTIVE' }, STRICT_LIVE_DATA),
        listScheduleAssignments(
          { startDate: dispatchWeek.start, endDate: dispatchWeek.end, limit: 250 },
          STRICT_LIVE_DATA,
        ),
      ]);
      const techs = employeeData.items;
      const [unassignedData, ...techDataArr] = await Promise.all([
        listTechnicianTasks({ state: 'READY', assignedOnly: false }, STRICT_LIVE_DATA),
        ...techs.map((tech) => listTechnicianTasks({ technicianId: tech.id }, STRICT_LIVE_DATA)),
      ]);

      setActiveTechs(techs);
      setUnassigned(unassignedData.items.filter((t) => !t.technicianId));
      setScheduleAssignments(
        scheduleData.items
          .filter((assignment) => DISPATCH_ASSIGNMENT_STATES.has(assignment.assignmentState))
          .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt)),
      );

      const map: Record<string, TechnicianTask[]> = {};
      techs.forEach((tech, i) => {
        map[tech.id] = techDataArr[i]?.items ?? [];
      });
      setTechTasks(map);

      lastRefreshRef.current = Date.now();
      setLastRefreshDisplay(Date.now());
      setIsStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [dispatchWeek.end, dispatchWeek.start]);

  useEffect(() => {
    void loadData();
    const refreshId = setInterval(() => void loadData(), REFRESH_INTERVAL);
    return () => clearInterval(refreshId);
  }, [loadData]);

  // Check for stale data every 15s
  useEffect(() => {
    const staleId = setInterval(() => {
      setIsStale(Date.now() - lastRefreshRef.current > STALE_THRESHOLD);
    }, 15_000);
    return () => clearInterval(staleId);
  }, []);

  function openAssignSheet(task: TechnicianTask) {
    setSelectedTask(task);
    setAssigningTechId(task.technicianId ?? null);
    setSheetOpen(true);
  }

  async function handleAssign() {
    if (!selectedTask || !assigningTechId) return;
    setAssigning(true);
    try {
      const resp = await apiFetch<{ task: TechnicianTask }>(
        `/tickets/technician-tasks/${selectedTask.id}/state`,
        {
          method: 'PATCH',
          body: JSON.stringify({ state: 'READY', technicianId: assigningTechId }),
          headers: mutationHeaders(),
        },
        undefined,
        STRICT_LIVE_DATA,
      );

      // Optimistically move the task
      setUnassigned((prev) => prev.filter((t) => t.id !== selectedTask.id));
      setTechTasks((prev) => {
        const cleaned: Record<string, TechnicianTask[]> = {};
        for (const [tid, tasks] of Object.entries(prev)) {
          cleaned[tid] = tasks.filter((t) => t.id !== selectedTask.id);
        }
        cleaned[assigningTechId] = [resp.task, ...(cleaned[assigningTechId] ?? [])];
        return cleaned;
      });

      const tech = activeTechs.find((t) => t.id === assigningTechId);
      toast.success(`Assigned to ${tech ? `${tech.firstName} ${tech.lastName}` : assigningTechId}`);
      setSheetOpen(false);
      setSelectedTask(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign task');
    } finally {
      setAssigning(false);
    }
  }

  async function handleOperationTransition(
    assignment: ScheduleAssignment,
    status: WoOperationStatus,
    blockingReasonText?: string,
  ) {
    const actionId = `${assignment.id}:${status}`;
    setOperationActionId(actionId);
    try {
      const response = await transitionWoOperation(
        assignment.workOrderId,
        assignment.operationId,
        {
          status,
          blockingReason: blockingReasonText,
          reasonCode: status === 'BLOCKED' ? 'DISPATCH_BLOCK' : 'DISPATCH_EXECUTION',
        },
        STRICT_LIVE_DATA,
      );
      setScheduleAssignments((prev) =>
        prev.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                operationStatus: response.operation.status ?? status,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      toast.success(getOperationToast(status));
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update operation');
    } finally {
      setOperationActionId(null);
    }
  }

  async function handleBlockOperation() {
    if (!blockingAssignment) return;
    const reason = blockingReason.trim();
    if (!reason) {
      toast.error('Enter the blocking reason before marking this operation blocked.');
      return;
    }
    await handleOperationTransition(blockingAssignment, 'BLOCKED', reason);
    setBlockingAssignment(null);
    setBlockingReason('');
  }

  const staleMinutes = Math.floor((Date.now() - lastRefreshDisplay) / 60_000);
  const dispatchActions = useMemo(
    () =>
      buildDispatchActions({
        scheduleAssignments,
        unassignedCount: unassigned.length,
        isStale,
      }),
    [isStale, scheduleAssignments, unassigned.length],
  );
  const todayState = summarizeDispatchState({
    loading,
    error,
    isStale,
    unassigned: unassigned.length,
    techCount: activeTechs.length,
    techTasks,
    scheduleAssignments,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dispatch Board"
        description={`Execute published schedule assignments for ${formatDateLabel(dispatchWeek.start)} to ${formatDateLabel(dispatchWeek.end)}`}
      />

      <DispatchBanner state={todayState} loading={loading} />

      {isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-700 flex items-center justify-between gap-3">
          <span>⚠ Data may be stale — last refreshed {staleMinutes}m ago</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadData()}
            className="min-h-[48px]"
          >
            Refresh
          </Button>
        </div>
      )}

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <span className="text-red-600 text-sm flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadData()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && dispatchActions.length > 0 && (
        <DispatchActionQueue actions={dispatchActions} />
      )}

      {!loading && !error && (
        <PublishedScheduleExecutionPanel
          assignments={scheduleAssignments}
          busyActionId={operationActionId}
          week={dispatchWeek}
          onBlock={(assignment) => {
            setBlockingAssignment(assignment);
            setBlockingReason(assignment.operationStatus === 'BLOCKED' ? 'Still blocked: ' : '');
          }}
          onComplete={(assignment) => void handleOperationTransition(assignment, 'DONE')}
          onRefresh={() => void loadData()}
          onResume={(assignment) => void handleOperationTransition(assignment, 'READY')}
          onStart={(assignment) => void handleOperationTransition(assignment, 'IN_PROGRESS')}
        />
      )}

      {loading ? (
        <div className="animate-pulse grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-lg" />
          ))}
        </div>
      ) : (
        <div id="technician-assignments" className="flex flex-col md:flex-row gap-4 items-start">
          {/* Unassigned panel */}
          <div className="w-full md:w-72 flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Unassigned Tasks</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                {unassigned.length}
              </span>
            </div>
            <div className="space-y-2">
              {unassigned.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center text-sm text-gray-400">
                  All tasks assigned ✓
                </div>
              ) : (
                unassigned.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isBusy={false}
                    onAssign={() => openAssignSheet(task)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Per-technician columns */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            {activeTechs.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-10 text-center text-sm text-gray-400">
                No active technicians
              </div>
            ) : (
              <div className="flex gap-4">
                {activeTechs.map((tech) => {
                  const tasks = techTasks[tech.id] ?? [];
                  const hasInProgress = tasks.some((t) => t.state === 'IN_PROGRESS');
                  return (
                    <div key={tech.id} className="min-w-[220px] flex-shrink-0">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-xs font-bold text-gray-900">
                          {tech.firstName[0]}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-700 truncate">
                          {tech.firstName} {tech.lastName}
                        </h3>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                          {tasks.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {tasks.length === 0 ? (
                          <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center text-xs text-gray-400">
                            No tasks
                          </div>
                        ) : (
                          tasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              showReassign
                              isBusy={hasInProgress && task.state !== 'IN_PROGRESS'}
                              onAssign={() => openAssignSheet(task)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assign / Reassign sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{selectedTask?.technicianId ? 'Reassign Task' : 'Assign Task'}</SheetTitle>
          </SheetHeader>

          {selectedTask && (
            <div className="px-4 space-y-4 flex-1 overflow-y-auto py-4">
              {/* Task summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="font-mono text-xs text-gray-500">
                  {selectedTask.workOrderNumber}
                </div>
                <div className="text-sm font-medium text-gray-900">
                  {selectedTask.routingStepTitle}
                </div>
                {(selectedTask.requiredSkillCodes?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-xs text-gray-500">Required skills:</span>
                    {selectedTask.requiredSkillCodes!.map((s) => (
                      <span
                        key={s}
                        className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Technician list */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Select Technician
                </p>
                {activeTechs.map((tech) => {
                  const missing = missingSkills(tech, selectedTask.requiredSkillCodes ?? []);
                  const isCurrent = tech.id === selectedTask.technicianId;
                  const isSelected = assigningTechId === tech.id;
                  return (
                    <button
                      key={tech.id}
                      onClick={() => setAssigningTechId(tech.id)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        isSelected
                          ? 'border-yellow-400 bg-yellow-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">
                          {tech.firstName} {tech.lastName}
                          {isCurrent && (
                            <span className="ml-2 text-xs text-gray-400 font-normal">
                              (current)
                            </span>
                          )}
                        </span>
                        {isSelected && <span className="text-yellow-600 text-sm">✓</span>}
                      </div>
                      {missing.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1">
                          ⚠ Missing skills: {missing.join(', ')}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <SheetFooter>
            <Button
              onClick={() => void handleAssign()}
              disabled={!assigningTechId || assigning}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold min-h-[48px] disabled:opacity-50"
            >
              {assigning ? 'Assigning…' : 'Confirm Assign'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(blockingAssignment)}
        onOpenChange={(open) => {
          if (!open) {
            setBlockingAssignment(null);
            setBlockingReason('');
          }
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Block Operation</SheetTitle>
          </SheetHeader>

          {blockingAssignment && (
            <div className="px-4 space-y-4 flex-1 overflow-y-auto py-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="font-mono text-xs font-semibold text-gray-700">
                  #{blockingAssignment.workOrderNumber}
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900">
                  {blockingAssignment.operationName}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {formatTime(blockingAssignment.plannedStartAt)} to{' '}
                  {formatTime(blockingAssignment.plannedEndAt)} ·{' '}
                  {blockingAssignment.stockLocationCode}
                  {blockingAssignment.bayCode ? ` · ${blockingAssignment.bayCode}` : ''}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Blocking reason
                </span>
                <textarea
                  value={blockingReason}
                  onChange={(event) => setBlockingReason(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
                  placeholder="What must happen before this operation can continue?"
                />
              </label>
            </div>
          )}

          <SheetFooter>
            <Button
              type="button"
              onClick={() => void handleBlockOperation()}
              disabled={!blockingAssignment || !blockingReason.trim() || operationActionId !== null}
              className="w-full min-h-[48px] bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              Mark blocked
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface DispatchAction {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  cta: string;
  href: string;
}

function DispatchActionQueue({ actions }: { actions: DispatchAction[] }) {
  const severityStyles: Record<DispatchAction['severity'], string> = {
    high: 'border-red-200 bg-red-50 text-red-950',
    medium: 'border-amber-200 bg-amber-50 text-amber-950',
    low: 'border-gray-200 bg-gray-50 text-gray-900',
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Action queue</h2>
      </header>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {actions.map((action) => (
          <div
            key={action.title}
            className={`rounded-lg border p-3 ${severityStyles[action.severity]}`}
          >
            <div className="text-sm font-semibold">{action.title}</div>
            <div className="mt-1 text-xs opacity-80">{action.detail}</div>
            <Link
              href={action.href}
              className="mt-3 inline-flex min-h-[40px] items-center gap-1 rounded-md bg-white px-3 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
            >
              {action.cta}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function PublishedScheduleExecutionPanel({
  assignments,
  busyActionId,
  week,
  onBlock,
  onComplete,
  onRefresh,
  onResume,
  onStart,
}: {
  assignments: ScheduleAssignment[];
  busyActionId: string | null;
  week: DispatchWeek;
  onBlock: (assignment: ScheduleAssignment) => void;
  onComplete: (assignment: ScheduleAssignment) => void;
  onRefresh: () => void;
  onResume: (assignment: ScheduleAssignment) => void;
  onStart: (assignment: ScheduleAssignment) => void;
}) {
  const metrics = summarizeScheduleAssignments(assignments);

  return (
    <section id="published-schedule" className="rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Published schedule</h2>
          <p className="text-xs text-gray-500">
            Start, complete, or block planned work for {formatDateLabel(week.start)} to{' '}
            {formatDateLabel(week.end)}.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </header>

      <div className="grid gap-2 border-b border-gray-100 p-4 text-sm md:grid-cols-4">
        <MetricPill label="Ready to start" value={String(metrics.ready)} />
        <MetricPill label="In progress" value={String(metrics.inProgress)} />
        <MetricPill label="Blocked" value={String(metrics.blocked)} />
        <MetricPill label="Complete" value={String(metrics.done)} />
      </div>

      {assignments.length === 0 ? (
        <div className="p-4">
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
            <div className="font-semibold text-gray-900">
              No published schedule assignments for this week.
            </div>
            <div className="mt-1 text-xs">
              Publish the build-slot plan before dispatch starts assigning shop execution work.
            </div>
            <Link
              href={erpRoute('build-slot')}
              className="mt-3 inline-flex min-h-[40px] items-center gap-1 rounded-md bg-yellow-400 px-3 text-xs font-semibold text-gray-900 hover:bg-yellow-300"
            >
              Publish schedule
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {assignments.map((assignment) => (
            <ScheduleAssignmentRow
              key={assignment.id}
              assignment={assignment}
              busy={Boolean(busyActionId?.startsWith(`${assignment.id}:`))}
              onBlock={onBlock}
              onComplete={onComplete}
              onResume={onResume}
              onStart={onStart}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleAssignmentRow({
  assignment,
  busy,
  onBlock,
  onComplete,
  onResume,
  onStart,
}: {
  assignment: ScheduleAssignment;
  busy: boolean;
  onBlock: (assignment: ScheduleAssignment) => void;
  onComplete: (assignment: ScheduleAssignment) => void;
  onResume: (assignment: ScheduleAssignment) => void;
  onStart: (assignment: ScheduleAssignment) => void;
}) {
  const status = normalizeOperationStatus(assignment.operationStatus);
  const terminal = TERMINAL_OPERATION_STATUSES.has(status);
  const locationLabel = [assignment.stockLocationCode, assignment.bayCode, assignment.teamCode]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(210px,auto)] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={erpRecordRoute('work-order', assignment.workOrderId)}
            className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-gray-900 hover:underline"
          >
            #{assignment.workOrderNumber}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <StatusBadge status={status} />
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
            {assignment.assignmentState}
          </span>
        </div>
        <div className="mt-1 text-sm font-medium text-gray-900">
          {assignment.operationCode} · {assignment.operationName}
        </div>
        <div className="mt-0.5 truncate text-xs text-gray-500">{assignment.title}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>
            {formatTime(assignment.plannedStartAt)} to {formatTime(assignment.plannedEndAt)}
          </span>
          <span>{formatMinutes(assignment.estimatedMinutes)}</span>
          {locationLabel && <span>{locationLabel}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        {status === 'IN_PROGRESS' ? (
          <Button type="button" size="sm" onClick={() => onComplete(assignment)} disabled={busy}>
            <CheckCircle2 data-icon="inline-start" />
            Complete
          </Button>
        ) : status === 'BLOCKED' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onResume(assignment)}
            disabled={busy}
          >
            <RotateCcw data-icon="inline-start" />
            Resume
          </Button>
        ) : !terminal ? (
          <Button type="button" size="sm" onClick={() => onStart(assignment)} disabled={busy}>
            <Play data-icon="inline-start" />
            Start operation
          </Button>
        ) : null}

        {!terminal && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onBlock(assignment)}
            disabled={busy}
          >
            <Ban data-icon="inline-start" />
            Block
          </Button>
        )}
      </div>
    </li>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

interface DispatchTodayState {
  tone: 'green' | 'amber' | 'red' | 'neutral';
  headline: string;
  subhead: string;
}

function normalizeOperationStatus(status: string): WoOperationStatus {
  return ['PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'SKIPPED', 'CANCELLED'].includes(
    status,
  )
    ? (status as WoOperationStatus)
    : 'READY';
}

function summarizeScheduleAssignments(assignments: ScheduleAssignment[]) {
  return assignments.reduce(
    (summary, assignment) => {
      const status = normalizeOperationStatus(assignment.operationStatus);
      if (status === 'IN_PROGRESS') summary.inProgress += 1;
      else if (status === 'BLOCKED') summary.blocked += 1;
      else if (status === 'DONE') summary.done += 1;
      else if (!TERMINAL_OPERATION_STATUSES.has(status)) summary.ready += 1;
      return summary;
    },
    { ready: 0, inProgress: 0, blocked: 0, done: 0 },
  );
}

function buildDispatchActions({
  scheduleAssignments,
  unassignedCount,
  isStale,
}: {
  scheduleAssignments: ScheduleAssignment[];
  unassignedCount: number;
  isStale: boolean;
}): DispatchAction[] {
  const schedule = summarizeScheduleAssignments(scheduleAssignments);
  const actions: DispatchAction[] = [];

  if (scheduleAssignments.length === 0) {
    actions.push({
      severity: 'high',
      title: 'Publish the build schedule',
      detail: 'Dispatch cannot start planned operations until the planner publishes this week.',
      cta: 'Open planner',
      href: erpRoute('build-slot'),
    });
  }

  if (schedule.blocked > 0) {
    actions.push({
      severity: 'high',
      title: `${schedule.blocked} scheduled operation${schedule.blocked === 1 ? '' : 's'} blocked`,
      detail:
        'Resolve blockers before filling more work into the affected bay, team, or work order.',
      cta: 'Review blocked work',
      href: erpRoute('blocked-work', { status: 'BLOCKED' }),
    });
  }

  if (schedule.ready > 0) {
    actions.push({
      severity: 'medium',
      title: `${schedule.ready} operation${schedule.ready === 1 ? '' : 's'} ready to start`,
      detail: 'Start scheduled operations when the bay and technician are ready.',
      cta: 'Start work',
      href: '#published-schedule',
    });
  }

  if (unassignedCount > 0) {
    actions.push({
      severity: 'medium',
      title: `${unassignedCount} technician task${unassignedCount === 1 ? '' : 's'} unassigned`,
      detail: 'Assign unowned task cards after scheduled operations are triaged.',
      cta: 'Assign tasks',
      href: '#technician-assignments',
    });
  }

  if (isStale) {
    actions.push({
      severity: 'low',
      title: 'Dispatch data is stale',
      detail: 'Refresh before changing shop execution state.',
      cta: 'Refresh board',
      href: '#published-schedule',
    });
  }

  return actions.slice(0, 4);
}

function getOperationToast(status: WoOperationStatus): string {
  if (status === 'IN_PROGRESS') return 'Operation started';
  if (status === 'DONE') return 'Operation completed';
  if (status === 'BLOCKED') return 'Operation blocked';
  if (status === 'READY') return 'Operation resumed';
  return 'Operation updated';
}

function summarizeDispatchState(args: {
  loading: boolean;
  error: string | null;
  isStale: boolean;
  unassigned: number;
  techCount: number;
  techTasks: Record<string, TechnicianTask[]>;
  scheduleAssignments: ScheduleAssignment[];
}): DispatchTodayState {
  if (args.error) {
    return {
      tone: 'red',
      headline: 'Dispatch board failed to load.',
      subhead: 'Tasks below may be missing or stale. Retry the request to recover.',
    };
  }
  if (args.techCount === 0) {
    return {
      tone: 'amber',
      headline: 'No active technicians on shift.',
      subhead: 'Add or activate a technician before assigning tasks.',
    };
  }
  const schedule = summarizeScheduleAssignments(args.scheduleAssignments);
  if (args.scheduleAssignments.length === 0) {
    return {
      tone: 'amber',
      headline: 'No published schedule is available for dispatch.',
      subhead:
        'Publish the build-slot schedule so dispatch can start real shop operations from this page.',
    };
  }
  if (schedule.blocked > 0) {
    return {
      tone: 'red',
      headline: `${schedule.blocked} scheduled operation${schedule.blocked === 1 ? '' : 's'} blocked.`,
      subhead: 'Review blockers before assigning more work into the same bay or team.',
    };
  }
  const inProgress = Object.values(args.techTasks)
    .flat()
    .filter((t) => t.state === 'IN_PROGRESS').length;
  if (schedule.ready > 0) {
    return {
      tone: 'amber',
      headline: `${schedule.ready} scheduled operation${schedule.ready === 1 ? '' : 's'} ready to start.`,
      subhead: `${schedule.inProgress} operation${schedule.inProgress === 1 ? '' : 's'} in progress · ${args.unassigned} technician task${args.unassigned === 1 ? '' : 's'} unassigned.`,
    };
  }
  if (args.unassigned === 0) {
    return {
      tone: 'green',
      headline: 'Queue is clear.',
      subhead: `All READY tasks are assigned. ${inProgress} task${inProgress === 1 ? '' : 's'} in progress across ${args.techCount} tech${args.techCount === 1 ? '' : 's'}.`,
    };
  }
  return {
    tone: 'amber',
    headline: `${args.unassigned} task${args.unassigned === 1 ? '' : 's'} waiting to be assigned.`,
    subhead: `${inProgress} in progress · ${args.techCount} tech${args.techCount === 1 ? '' : 's'} on shift. Tap "+ Assign" on any unassigned card to route it.`,
  };
}

function DispatchBanner({ state, loading }: { state: DispatchTodayState; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 animate-pulse">
        <div className="h-5 w-64 bg-gray-200 rounded" />
        <div className="h-3 w-96 bg-gray-100 rounded mt-2" />
      </div>
    );
  }
  const toneStyles: Record<DispatchTodayState['tone'], string> = {
    green: 'bg-green-50 border-green-200 text-green-900',
    amber: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    neutral: 'bg-gray-50 border-gray-200 text-gray-900',
  };
  return (
    <div className={`border rounded-lg p-4 ${toneStyles[state.tone]}`}>
      <div className="font-semibold text-base">{state.headline}</div>
      <div className="text-sm mt-1 opacity-80">{state.subhead}</div>
    </div>
  );
}
