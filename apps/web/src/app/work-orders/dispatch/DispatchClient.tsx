'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  apiFetch,
  listTechnicianTasks,
  MOCK_EMPLOYEES,
  mutationHeaders,
} from '@/lib/api-client';
import type { Employee, TechnicianTask } from '@/lib/api-client';

const REFRESH_INTERVAL = 30_000;
const STALE_THRESHOLD = 2 * 60_000;

// Hardcoded skill map for MVP — replace with API data when available
const TECH_SKILL_MAP: Record<string, string[]> = {
  'emp-1': ['ELECTRICAL', 'BATTERY', 'MECHANICAL'],
  'emp-2': ['ELECTRICAL', 'SUSPENSION', 'MECHANICAL'],
};

const ACTIVE_TECHS = MOCK_EMPLOYEES.filter(e => e.employmentState === 'ACTIVE');

function formatAge(ts: string): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function missingSkills(tech: Employee, required: string[]): string[] {
  const techSkills = TECH_SKILL_MAP[tech.id] ?? [];
  return required.filter(s => !techSkills.includes(s));
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
          <div className="font-mono text-xs text-gray-500">{task.workOrderNumber ?? task.workOrderId}</div>
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
          {task.requiredSkillCodes!.map(skill => (
            <span key={skill} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{skill}</span>
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
  const [unassigned, setUnassigned] = useState<TechnicianTask[]>([]);
  const [techTasks, setTechTasks] = useState<Record<string, TechnicianTask[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastRefreshDisplay, setLastRefreshDisplay] = useState<number>(Date.now());
  const lastRefreshRef = useRef<number>(Date.now());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TechnicianTask | null>(null);
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [unassignedData, ...techDataArr] = await Promise.all([
        listTechnicianTasks({ state: 'READY', assignedOnly: false }),
        ...ACTIVE_TECHS.map(tech => listTechnicianTasks({ technicianId: tech.id })),
      ]);

      setUnassigned(unassignedData.items.filter(t => !t.technicianId));

      const map: Record<string, TechnicianTask[]> = {};
      ACTIVE_TECHS.forEach((tech, i) => {
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
  }, []);

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
        { task: { ...selectedTask, technicianId: assigningTechId, updatedAt: new Date().toISOString() } },
      );

      // Optimistically move the task
      setUnassigned(prev => prev.filter(t => t.id !== selectedTask.id));
      setTechTasks(prev => {
        const cleaned: Record<string, TechnicianTask[]> = {};
        for (const [tid, tasks] of Object.entries(prev)) {
          cleaned[tid] = tasks.filter(t => t.id !== selectedTask.id);
        }
        cleaned[assigningTechId] = [resp.task, ...(cleaned[assigningTechId] ?? [])];
        return cleaned;
      });

      const tech = ACTIVE_TECHS.find(t => t.id === assigningTechId);
      toast.success(`Assigned to ${tech ? `${tech.firstName} ${tech.lastName}` : assigningTechId}`);
      setSheetOpen(false);
      setSelectedTask(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign task');
    } finally {
      setAssigning(false);
    }
  }

  const staleMinutes = Math.floor((Date.now() - lastRefreshDisplay) / 60_000);

  return (
    <div className="space-y-4">
      <PageHeader title="Dispatch Board" description="Assign and manage technician tasks" />

      {isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-700 flex items-center justify-between gap-3">
          <span>⚠ Data may be stale — last refreshed {staleMinutes}m ago</span>
          <Button size="sm" variant="outline" onClick={() => void loadData()} className="min-h-[48px]">
            Refresh
          </Button>
        </div>
      )}

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <span className="text-red-600 text-sm flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadData()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="animate-pulse grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-gray-100 rounded-lg" />)}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4 items-start">
          {/* Unassigned panel */}
          <div className="w-full md:w-72 flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Unassigned Tasks</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{unassigned.length}</span>
            </div>
            <div className="space-y-2">
              {unassigned.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center text-sm text-gray-400">
                  All tasks assigned ✓
                </div>
              ) : (
                unassigned.map(task => (
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
            {ACTIVE_TECHS.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-10 text-center text-sm text-gray-400">
                No active technicians
              </div>
            ) : (
              <div className="flex gap-4">
                {ACTIVE_TECHS.map(tech => {
                  const tasks = techTasks[tech.id] ?? [];
                  const hasInProgress = tasks.some(t => t.state === 'IN_PROGRESS');
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
                          tasks.map(task => (
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
            <SheetTitle>
              {selectedTask?.technicianId ? 'Reassign Task' : 'Assign Task'}
            </SheetTitle>
          </SheetHeader>

          {selectedTask && (
            <div className="px-4 space-y-4 flex-1 overflow-y-auto py-4">
              {/* Task summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="font-mono text-xs text-gray-500">{selectedTask.workOrderNumber}</div>
                <div className="text-sm font-medium text-gray-900">{selectedTask.routingStepTitle}</div>
                {(selectedTask.requiredSkillCodes?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-xs text-gray-500">Required skills:</span>
                    {selectedTask.requiredSkillCodes!.map(s => (
                      <span key={s} className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Technician list */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select Technician</p>
                {ACTIVE_TECHS.map(tech => {
                  const missing = missingSkills(tech, selectedTask.requiredSkillCodes ?? []);
                  const isCurrent = tech.id === selectedTask.technicianId;
                  const isSelected = assigningTechId === tech.id;
                  return (
                    <button
                      key={tech.id}
                      onClick={() => setAssigningTechId(tech.id)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        isSelected ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">
                          {tech.firstName} {tech.lastName}
                          {isCurrent && <span className="ml-2 text-xs text-gray-400 font-normal">(current)</span>}
                        </span>
                        {isSelected && <span className="text-yellow-600 text-sm">✓</span>}
                      </div>
                      {missing.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1">⚠ Missing skills: {missing.join(', ')}</p>
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
    </div>
  );
}
