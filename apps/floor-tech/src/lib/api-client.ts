import type { TechQueueItem, WorkOrderDetail } from './mock-data';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

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

export async function fetchQueue(): Promise<TechQueueItem[]> {
  const res = await fetch(`${API_BASE}/tickets/wo-queue`);
  if (!res.ok) throw new Error(`Failed to load queue (${res.status})`);
  const data: { items: TechQueueItem[] } = await res.json();
  return data.items ?? [];
}

export async function fetchWorkOrder(id: string): Promise<WorkOrderDetail> {
  const res = await fetch(`${API_BASE}/tickets/wo-queue/${id}`);
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
  const res = await fetch(`${API_BASE}/tickets/time-entries?${qs}`);
  if (!res.ok) throw new Error(`Failed to load time entries (${res.status})`);
  const data: { entries: TimeEntry[] } = await res.json();
  return data.entries ?? [];
}
