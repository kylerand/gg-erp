const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Set this to inject an auth token for all requests (call from auth context). */
let _authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  _authToken = token;
}

async function apiFetch<T>(path: string, init?: RequestInit, fallback?: T): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (_authToken) headers['authorization'] = `Bearer ${_authToken}`;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      cache: 'no-store',
    });
    if (res.ok) return res.json() as Promise<T>;
    if (fallback !== undefined) return fallback;
    const errBody = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(errBody.message ?? `API error ${res.status}: ${path}`);
  } catch (err) {
    if (fallback !== undefined) return fallback;
    if (err instanceof Error) throw err;
    throw new Error(`Network error calling ${path}`);
  }
}

// ─── Work Orders (planning schema) ───────────────────────────────────────────

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  customerId?: string;
  buildConfigurationId: string;
  bomId: string;
  state: 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
  description?: string;
  scheduledDate?: string;
  assigneeId?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkOrderInput {
  workOrderNumber: string;
  vehicleId: string;
  customerId?: string;
  buildConfigurationId: string;
  bomId: string;
  description?: string;
  scheduledDate?: string;
}

export const MOCK_WORK_ORDERS: WorkOrder[] = [
  { id: 'wo-1', workOrderNumber: 'WO-001', vehicleId: 'v-001', buildConfigurationId: 'bc-001', bomId: 'bom-001', state: 'IN_PROGRESS', description: 'Full cart restoration', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'wo-2', workOrderNumber: 'WO-002', vehicleId: 'v-002', buildConfigurationId: 'bc-002', bomId: 'bom-002', state: 'BLOCKED', description: 'Waiting on battery pack', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'wo-3', workOrderNumber: 'WO-003', vehicleId: 'v-003', buildConfigurationId: 'bc-001', bomId: 'bom-001', state: 'PLANNED', description: 'New build — Street Legal', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export async function listWorkOrders(params?: { state?: string; limit?: number }): Promise<{ items: WorkOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/planning/work-orders${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_WORK_ORDERS, total: MOCK_WORK_ORDERS.length });
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const data = await apiFetch<{ workOrder: WorkOrder }>('/planning/work-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.workOrder;
}

export async function transitionWorkOrderState(id: string, state: WorkOrder['state']): Promise<WorkOrder> {
  const data = await apiFetch<{ workOrder: WorkOrder }>(`/planning/work-orders/${id}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state }),
  });
  return data.workOrder;
}

// ─── Work Orders (execution schema — WoOrder) ────────────────────────────────

export interface WoOrder {
  id: string;
  workOrderNumber: string;
  title: string;
  description?: string;
  customerReference?: string;
  assetReference?: string;
  status: 'DRAFT' | 'READY' | 'SCHEDULED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  stockLocationId?: string;
  openedAt: string;
  dueAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_WO_ORDERS: WoOrder[] = [
  { id: 'wo-ex-1', workOrderNumber: 'WO-2024-0001', title: 'Club Car DS Full Build — Lifted Off-Road', customerReference: 'CUST-DEMO-001', status: 'READY', priority: 2, openedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export async function listWoOrders(params?: { status?: string; search?: string; limit?: number }): Promise<{ items: WoOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/work-orders${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_WO_ORDERS, total: MOCK_WO_ORDERS.length });
}

export async function getWoOrder(id: string): Promise<WoOrder | null> {
  return apiFetch<WoOrder | null>(`/work-orders/${id}`, undefined, null);
}

// ─── Customers ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  state: 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  preferredContactMethod: 'EMAIL' | 'PHONE' | 'SMS';
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  fullName: string;
  email: string;
  companyName?: string;
  phone?: string;
  preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS';
}

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c-1', fullName: 'John Smith', email: 'john@example.com', state: 'ACTIVE', preferredContactMethod: 'EMAIL', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'c-2', fullName: 'Riverside Golf Club', companyName: 'Riverside Golf Club LLC', email: 'ops@riverside.com', state: 'ACTIVE', preferredContactMethod: 'EMAIL', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'c-3', fullName: 'New Lead Corp', email: 'lead@example.com', state: 'LEAD', preferredContactMethod: 'PHONE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export async function listCustomers(params?: { state?: string; search?: string }): Promise<{ items: Customer[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.search) qs.set('search', params.search);
  return apiFetch(`/identity/customers${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_CUSTOMERS, total: MOCK_CUSTOMERS.length });
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const data = await apiFetch<{ customer: Customer }>('/identity/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.customer;
}

export async function transitionCustomerState(id: string, state: Customer['state']): Promise<Customer> {
  const data = await apiFetch<{ customer: Customer }>(`/identity/customers/${id}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state }),
  });
  return data.customer;
}

// ─── Inventory / Parts ────────────────────────────────────────────────────────

export interface Part {
  id: string;
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  partState: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  reorderPoint: number;
  /** Populated when fetching parts with stock summary */
  quantityOnHand?: number;
  location?: string;
}

export const MOCK_PARTS: Part[] = [
  { id: 'p-1', sku: 'BATT-48V-105AH', name: '48V 105Ah Lithium Battery Pack', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 2, quantityOnHand: 4, location: 'B-12' },
  { id: 'p-2', sku: 'MOTOR-AC-5HP', name: 'AC 5HP Golf Cart Motor', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 1, quantityOnHand: 2, location: 'A-03' },
  { id: 'p-3', sku: 'CTRL-SEVCON-48V', name: 'Sevcon 48V Motor Controller', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 1, quantityOnHand: 0, location: 'A-07' },
  { id: 'p-4', sku: 'CHARGER-48V-15A', name: '48V 15A Onboard Charger', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 2, quantityOnHand: 6, location: 'C-02' },
];

export async function listParts(params?: { search?: string; partState?: string; limit?: number }): Promise<{ items: Part[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.partState) qs.set('partState', params.partState);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/inventory/parts${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_PARTS, total: MOCK_PARTS.length });
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorState: 'ACTIVE' | 'ON_HOLD' | 'INACTIVE';
  email?: string;
  phone?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
}

export const MOCK_VENDORS: Vendor[] = [
  { id: 'v-1', vendorCode: 'MADJAX', vendorName: 'MadJax Golf Cart Parts', vendorState: 'ACTIVE', email: 'orders@madjax.com', leadTimeDays: 5, paymentTerms: 'NET30' },
];

export async function listVendors(): Promise<{ items: Vendor[]; total: number }> {
  return apiFetch('/inventory/vendors', undefined, { items: MOCK_VENDORS, total: MOCK_VENDORS.length });
}

// ─── Employees / Technicians ──────────────────────────────────────────────────

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  employmentState: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  hireDate: string;
}

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'emp-1', employeeNumber: 'EMP-001', firstName: 'Dev', lastName: 'Admin', employmentState: 'ACTIVE', hireDate: '2024-01-01' },
  { id: 'emp-2', employeeNumber: 'EMP-002', firstName: 'Sample', lastName: 'Tech', employmentState: 'ACTIVE', hireDate: '2024-03-01' },
];

export async function listEmployees(params?: { employmentState?: string }): Promise<{ items: Employee[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.employmentState) qs.set('state', params.employmentState);
  return apiFetch(`/hr/employees${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_EMPLOYEES, total: MOCK_EMPLOYEES.length });
}

// ─── Technician Tasks ─────────────────────────────────────────────────────────

export interface TechnicianTask {
  id: string;
  workOrderId: string;
  routingStepId: string;
  technicianId?: string;
  state: 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  updatedAt: string;
}

export const MOCK_TASKS: TechnicianTask[] = [
  { id: 't-1', workOrderId: 'wo-ex-1', routingStepId: 'step-1', technicianId: 'emp-2', state: 'IN_PROGRESS', updatedAt: new Date().toISOString() },
];

export async function listTechnicianTasks(params: { workOrderId?: string; technicianId?: string; state?: string }): Promise<{ items: TechnicianTask[] }> {
  const qs = new URLSearchParams();
  if (params.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params.technicianId) qs.set('technicianId', params.technicianId);
  if (params.state) qs.set('state', params.state);
  return apiFetch(`/tickets/tasks${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_TASKS });
}

// ─── Rework Issues ────────────────────────────────────────────────────────────

export interface ReworkIssue {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  state: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REOPENED' | 'CLOSED';
  reportedBy: string;
  assignedTo?: string;
  createdAt: string;
  resolvedAt?: string;
}

export const MOCK_REWORK: ReworkIssue[] = [];

export async function listReworkIssues(workOrderId: string): Promise<{ items: ReworkIssue[] }> {
  return apiFetch(`/tickets/rework?workOrderId=${workOrderId}`, undefined, { items: MOCK_REWORK });
}

// ─── Sync / Accounting ────────────────────────────────────────────────────────

export interface InvoiceSyncRecord {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: 'QUICKBOOKS' | 'GENERIC';
  state: 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  externalReference?: string;
  createdAt: string;
  syncedAt?: string;
}

export const MOCK_SYNC_RECORDS: InvoiceSyncRecord[] = [
  { id: 's-1', invoiceNumber: 'INV-001', workOrderId: 'wo-ex-1', provider: 'QUICKBOOKS', state: 'FAILED', attemptCount: 3, lastErrorMessage: 'QB connection timeout', createdAt: new Date().toISOString() },
  { id: 's-2', invoiceNumber: 'INV-002', workOrderId: 'wo-ex-1', provider: 'QUICKBOOKS', state: 'SYNCED', attemptCount: 1, externalReference: 'QB-INV-12345', createdAt: new Date().toISOString() },
];

export async function listInvoiceSyncRecords(params?: { state?: string; workOrderId?: string }): Promise<{ items: InvoiceSyncRecord[] }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
  return apiFetch(`/accounting/invoice-sync${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_SYNC_RECORDS });
}

// ─── Dealers (legacy alias) ───────────────────────────────────────────────────

export interface Dealer {
  id: string;
  name: string;
  contactEmail?: string;
  serviceRelationship: 'ACTIVE' | 'INACTIVE';
  territory?: string;
}

export const MOCK_DEALERS: Dealer[] = [
  { id: 'd-1', name: 'East Coast Golf Carts', contactEmail: 'ops@ecgc.com', serviceRelationship: 'ACTIVE', territory: 'Southeast' },
  { id: 'd-2', name: 'Western Cart Co', contactEmail: 'service@wcc.com', serviceRelationship: 'ACTIVE', territory: 'West' },
];

export async function listDealers(): Promise<Dealer[]> {
  return apiFetch('/identity/dealers', undefined, MOCK_DEALERS);
}
