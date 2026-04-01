import type { TechQueueItem, WorkOrderDetail } from './mock-data';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Set this to inject an auth token for all requests (call from auth context). */
let _authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  _authToken = token;
}

export interface TimeEntry {
  id: string;
  workOrderId: string;
  technicianId: string;
  startedAt: string;
  endedAt?: string;
  description?: string;
  source: 'AUTO' | 'MANUAL' | 'ADJUSTED';
  computedHours: number;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (_authToken) headers['authorization'] = `Bearer ${_authToken}`;
  return headers;
}

export async function fetchQueue(): Promise<TechQueueItem[]> {
  const res = await fetch(`${API_BASE}/tickets/wo-queue`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load queue (${res.status})`);
  const data: { items: TechQueueItem[] } = await res.json();
  return data.items ?? [];
}

export async function fetchWorkOrder(id: string): Promise<WorkOrderDetail> {
  const res = await fetch(`${API_BASE}/tickets/wo-queue/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Work order not found (${res.status})`);
  const data: { workOrder: WorkOrderDetail } = await res.json();
  return data.workOrder;
}

export async function fetchTimeEntries(params: {
  workOrderId?: string;
  technicianId?: string;
}): Promise<TimeEntry[]> {
  const qs = new URLSearchParams();
  if (params.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params.technicianId) qs.set('technicianId', params.technicianId);
  const res = await fetch(`${API_BASE}/tickets/time-entries?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load time entries (${res.status})`);
  const data: { entries: TimeEntry[] } = await res.json();
  return data.entries ?? [];
}
