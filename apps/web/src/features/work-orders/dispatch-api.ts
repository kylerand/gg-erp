import { apiFetch } from '../../lib/api-client.js';
import type { TechnicianTask, TransitionTaskResponse } from './tasks-api.js';
import { MOCK_TECHNICIAN_TASKS } from './tasks-api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnassignedTaskSummary extends TechnicianTask {
  workOrderNumber: string;
  routingStepTitle: string;
  ageMinutes: number;
}

export interface TechnicianWorkload {
  technicianId: string;
  technicianName?: string;
  tasks: TechnicianTask[];
  inProgressCount: number;
  readyCount: number;
  blockedCount: number;
}

export interface AssignTaskInput {
  technicianId: string;
  ifMatch?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUnassigned(task: TechnicianTask): UnassignedTaskSummary {
  const ageMinutes = Math.floor(
    (Date.now() - new Date(task.createdAt).getTime()) / 60_000,
  );
  return {
    ...task,
    workOrderNumber: task.workOrderNumber ?? task.workOrderId,
    routingStepTitle: task.routingStepTitle ?? task.routingStepId,
    ageMinutes,
  };
}

function buildWorkload(technicianId: string, tasks: TechnicianTask[], name?: string): TechnicianWorkload {
  return {
    technicianId,
    technicianName: name,
    tasks,
    inProgressCount: tasks.filter((t) => t.state === 'IN_PROGRESS').length,
    readyCount: tasks.filter((t) => t.state === 'READY').length,
    blockedCount: tasks.filter((t) => t.state === 'BLOCKED').length,
  };
}

// ─── Mock fallbacks ───────────────────────────────────────────────────────────

const MOCK_UNASSIGNED: UnassignedTaskSummary[] = MOCK_TECHNICIAN_TASKS.filter(
  (t) => !t.technicianId && t.state === 'READY',
).map(toUnassigned);

// ─── API Functions ────────────────────────────────────────────────────────────

export async function fetchUnassignedTasks(
  workOrderId?: string,
): Promise<{ items: UnassignedTaskSummary[] }> {
  const qs = new URLSearchParams({ assignedOnly: 'false', state: 'READY' });
  const result = await apiFetch<{ items: TechnicianTask[]; total: number }>(
    `/tickets/technician-tasks?${qs}`,
    undefined,
    { items: MOCK_UNASSIGNED, total: MOCK_UNASSIGNED.length },
  );

  const items = result.items
    .filter((t) => !workOrderId || t.workOrderId === workOrderId)
    .map(toUnassigned);

  return { items };
}

export async function fetchTasksByTechnician(
  technicianIds: string[],
): Promise<TechnicianWorkload[]> {
  if (technicianIds.length === 0) return [];

  const settled = await Promise.allSettled(
    technicianIds.map((techId) =>
      apiFetch<{ items: TechnicianTask[] }>(
        `/tickets/technician-tasks?technicianId=${techId}`,
        undefined,
        {
          items: MOCK_TECHNICIAN_TASKS.filter((t) => t.technicianId === techId),
        },
      ).then((res) => ({ techId, tasks: res.items })),
    ),
  );

  return settled.map((result, i) => {
    const techId = technicianIds[i]!;
    const tasks = result.status === 'fulfilled' ? result.value.tasks : [];
    return buildWorkload(techId, tasks);
  });
}

export async function assignTask(
  taskId: string,
  input: AssignTaskInput,
): Promise<TransitionTaskResponse> {
  const { ifMatch, technicianId } = input;
  const headers: Record<string, string> = {
    'X-Correlation-Id': crypto.randomUUID(),
    'Idempotency-Key': crypto.randomUUID(),
  };
  if (ifMatch) headers['If-Match'] = ifMatch;

  return apiFetch<TransitionTaskResponse>(`/tickets/technician-tasks/${taskId}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'READY', technicianId }),
    headers,
  });
}

export async function reassignTask(
  taskId: string,
  newTechnicianId: string,
  ifMatch?: string,
): Promise<TransitionTaskResponse> {
  const headers: Record<string, string> = {
    'X-Correlation-Id': crypto.randomUUID(),
    'Idempotency-Key': crypto.randomUUID(),
  };
  if (ifMatch) headers['If-Match'] = ifMatch;

  return apiFetch<TransitionTaskResponse>(`/tickets/technician-tasks/${taskId}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'READY', technicianId: newTechnicianId }),
    headers,
  });
}
