import { apiFetch } from '../../lib/api-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TechnicianTaskState = 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';

export interface TechnicianTask {
  id: string;
  workOrderId: string;
  routingStepId: string;
  workOrderNumber?: string;
  routingStepTitle?: string;
  technicianId?: string;
  state: TechnicianTaskState;
  blockedReason?: string;
  blockedReasonCode?: string;
  blockedOwnerId?: string;
  requiredSkillCodes?: string[];
  estimatedMinutes?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListTechnicianTasksParams {
  workOrderId?: string;
  technicianId?: string;
  state?: TechnicianTaskState;
  assignedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListTechnicianTasksResponse {
  items: TechnicianTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransitionTaskInput {
  state: TechnicianTaskState;
  blockedReason?: string;
  blockedReasonCode?: string;
  technicianId?: string;
  ifMatch?: string;
}

export interface TransitionTaskResponse {
  task: TechnicianTask;
  event: { type: string; correlationId: string };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const _now = new Date().toISOString();

export const MOCK_TECHNICIAN_TASKS: TechnicianTask[] = [
  {
    id: 'task-1',
    workOrderId: 'wo-ex-1',
    routingStepId: 'step-1',
    workOrderNumber: 'WO-2024-0001',
    routingStepTitle: 'Battery Pack Installation',
    technicianId: 'emp-2',
    state: 'IN_PROGRESS',
    requiredSkillCodes: ['ELECTRICAL', 'BATTERY'],
    estimatedMinutes: 90,
    startedAt: _now,
    createdAt: _now,
    updatedAt: _now,
  },
  {
    id: 'task-2',
    workOrderId: 'wo-ex-1',
    routingStepId: 'step-2',
    workOrderNumber: 'WO-2024-0001',
    routingStepTitle: 'Motor Controller Wiring',
    state: 'READY',
    requiredSkillCodes: ['ELECTRICAL'],
    estimatedMinutes: 60,
    createdAt: _now,
    updatedAt: _now,
  },
  {
    id: 'task-3',
    workOrderId: 'wo-ex-1',
    routingStepId: 'step-3',
    workOrderNumber: 'WO-2024-0001',
    routingStepTitle: 'Lift Kit Assembly',
    technicianId: 'emp-2',
    state: 'BLOCKED',
    blockedReason: 'Waiting on lift kit parts from vendor',
    blockedReasonCode: 'PARTS_UNAVAILABLE',
    blockedOwnerId: 'emp-1',
    requiredSkillCodes: ['MECHANICAL'],
    estimatedMinutes: 120,
    createdAt: _now,
    updatedAt: _now,
  },
];

const MOCK_LIST_RESPONSE: ListTechnicianTasksResponse = {
  items: MOCK_TECHNICIAN_TASKS,
  total: MOCK_TECHNICIAN_TASKS.length,
  limit: 50,
  offset: 0,
};

// ─── API Functions ────────────────────────────────────────────────────────────

export async function fetchMyTasks(
  params: ListTechnicianTasksParams,
): Promise<ListTechnicianTasksResponse> {
  const qs = new URLSearchParams();
  if (params.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params.technicianId) qs.set('technicianId', params.technicianId);
  if (params.state) qs.set('state', params.state);
  if (params.assignedOnly !== undefined) qs.set('assignedOnly', String(params.assignedOnly));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const path = `/tickets/technician-tasks${qs.size ? `?${qs}` : ''}`;
  return apiFetch<ListTechnicianTasksResponse>(path, undefined, MOCK_LIST_RESPONSE);
}

export async function transitionTask(
  id: string,
  input: TransitionTaskInput,
): Promise<TransitionTaskResponse> {
  const { ifMatch, ...body } = input;
  const headers: Record<string, string> = {
    'X-Correlation-Id': crypto.randomUUID(),
    'Idempotency-Key': crypto.randomUUID(),
  };
  if (ifMatch) headers['If-Match'] = ifMatch;

  return apiFetch<TransitionTaskResponse>(`/tickets/technician-tasks/${id}/state`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers,
  });
}

export async function createTask(input: {
  workOrderId: string;
  routingStepId: string;
  technicianId?: string;
}): Promise<TransitionTaskResponse> {
  return apiFetch<TransitionTaskResponse>('/tickets/technician-tasks', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: {
      'X-Correlation-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
  });
}
