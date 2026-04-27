const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/**
 * Mock fallback is only used when the API base points at localhost (dev).
 * In production we must surface real errors — silent mocks previously caused
 * pages to render fake data when routes were missing, which masked deploy gaps.
 */
const ALLOW_MOCK_FALLBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(API_BASE);

/** Set this to inject an auth token for all requests (call from auth context). */
let _authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  _authToken = token;
}

/** Extended RequestInit with stale-write protection and internal queue-bypass flag. */
type ApiFetchInit = RequestInit & {
  /** When provided, adds `If-Match: <ifMatch>` for stale-write protection. */
  ifMatch?: string;
  /** Internal flag: skip offline queuing during replay to avoid re-queuing loops. */
  _skipQueue?: boolean;
};

function shouldUseFallback<T>(fallback: T | undefined): fallback is T {
  return fallback !== undefined && ALLOW_MOCK_FALLBACK;
}

function warnFallback(path: string, reason: string): void {
  if (typeof console !== 'undefined') {
    console.warn(`[api-client] Using mock fallback for ${path} (${reason}). Fix the API route.`);
  }
}

export async function apiFetch<T>(path: string, init?: ApiFetchInit, fallback?: T): Promise<T> {
  const { ifMatch, _skipQueue, ...fetchInit } = init ?? {};
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (_authToken) headers['authorization'] = `Bearer ${_authToken}`;
  if (ifMatch) headers['If-Match'] = ifMatch;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      headers: { ...headers, ...(fetchInit.headers as Record<string, string> | undefined) },
      cache: 'no-store',
    });
    if (res.ok) return res.json() as Promise<T>;

    // On 401, attempt token refresh and retry once
    if (res.status === 401 && typeof window !== 'undefined') {
      const freshToken = await tryRefreshToken();
      if (freshToken) {
        headers['authorization'] = `Bearer ${freshToken}`;
        const retry = await fetch(`${API_BASE}${path}`, {
          ...fetchInit,
          headers: { ...headers, ...(fetchInit.headers as Record<string, string> | undefined) },
          cache: 'no-store',
        });
        if (retry.ok) return retry.json() as Promise<T>;
      }
      // Refresh failed — redirect to login
      redirectToLogin();
      if (shouldUseFallback(fallback)) {
        warnFallback(path, 'auth refresh failed');
        return fallback;
      }
      throw new Error('Session expired. Redirecting to login.');
    }

    if (shouldUseFallback(fallback)) {
      warnFallback(path, `HTTP ${res.status}`);
      return fallback;
    }
    const errBody = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(errBody.message ?? `API error ${res.status}: ${path}`);
  } catch (err) {
    const method = (fetchInit.method ?? 'GET').toUpperCase();
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const reqHeaders = (fetchInit.headers as Record<string, string> | undefined) ?? {};
    const idempotencyKey = reqHeaders['Idempotency-Key'];
    if (isMutation && idempotencyKey && !_skipQueue && err instanceof TypeError && typeof window !== 'undefined') {
      queueMutation(path, method, fetchInit.body as string | undefined, idempotencyKey);
      return { _queued: true } as unknown as T;
    }
    if (shouldUseFallback(fallback)) {
      warnFallback(path, err instanceof Error ? err.message : 'network error');
      return fallback;
    }
    if (err instanceof Error) throw err;
    throw new Error(`Network error calling ${path}`);
  }
}

/** Attempt to refresh the Cognito token via Amplify. Returns new token or null. */
async function tryRefreshToken(): Promise<string | null> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession({ forceRefresh: true });
    const token = session.tokens?.idToken?.toString() ?? null;
    if (token) setAuthToken(token);
    return token;
  } catch {
    return null;
  }
}

let _redirecting = false;
function redirectToLogin() {
  if (_redirecting || typeof window === 'undefined') return;
  _redirecting = true;
  window.location.href = '/auth';
}

// ─── Offline Queue ─────────────────────────────────────────────────────────────────────────────

export interface OfflineQueueItem {
  path: string;
  method: string;
  body?: string;
  idempotencyKey: string;
  queuedAt: string;
}

export type QueuedSentinel = { _queued: true };

const OFFLINE_QUEUE_KEY = '_offline_queue';

function readOfflineQueue(): OfflineQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}

export function queueMutation(path: string, method: string, body: string | undefined, idempotencyKey: string): void {
  if (typeof window === 'undefined') return;
  const queue = readOfflineQueue();
  if (!queue.some(item => item.idempotencyKey === idempotencyKey)) {
    queue.push({ path, method, body, idempotencyKey, queuedAt: new Date().toISOString() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }
}

export async function replayOfflineQueue(): Promise<void> {
  if (typeof window === 'undefined') return;
  const queue = readOfflineQueue();
  if (queue.length === 0) return;
  const remaining: OfflineQueueItem[] = [];
  for (const item of queue) {
    try {
      await apiFetch(item.path, {
        method: item.method,
        body: item.body,
        headers: { 'Idempotency-Key': item.idempotencyKey },
        _skipQueue: true,
      });
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
}

let _queueReplaySetup = false;
export function setupOfflineQueueReplay(): void {
  if (typeof window === 'undefined' || _queueReplaySetup) return;
  _queueReplaySetup = true;
  window.addEventListener('offline-queue:replay', () => { void replayOfflineQueue(); });
}

// Auto-wire on import (no-op in SSR)
setupOfflineQueueReplay();

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

export async function listWoOrders(params?: { status?: string; search?: string; limit?: number; offset?: number }): Promise<{ items: WoOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/tickets/work-orders${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_WO_ORDERS, total: MOCK_WO_ORDERS.length });
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

export async function listCustomers(params?: { state?: string; search?: string; limit?: number; offset?: number }): Promise<{ items: Customer[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.search) qs.set('search', params.search);
  qs.set('limit', String(params?.limit ?? 25));
  if (params?.offset) qs.set('offset', String(params.offset));
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

export type LifecycleLevel =
  | 'RAW_MATERIAL'
  | 'RAW_COMPONENT'
  | 'PREPARED_COMPONENT'
  | 'ASSEMBLED_COMPONENT';

export type PartCategory =
  | 'ELECTRONICS'
  | 'AUDIO'
  | 'FABRICATION'
  | 'HARDWARE'
  | 'SMALL_PARTS'
  | 'DRIVE_TRAIN';

export type InstallStage =
  | 'FABRICATION'
  | 'FRAME'
  | 'WIRING'
  | 'PARTS_PREP'
  | 'FINAL_ASSEMBLY';

export type PartColor =
  | 'BLACK'
  | 'WHITE'
  | 'CHROME'
  | 'RAW_STEEL'
  | 'POWDER_COATED'
  | 'AMBER'
  | 'RED'
  | 'GREY'
  | 'BROWN'
  | 'RAW_ALUMINUM'
  | 'STAINLESS_STEEL';

export interface Part {
  id: string;
  sku: string;
  name: string;
  description?: string;
  variant?: string;
  color?: PartColor;
  category?: PartCategory;
  lifecycleLevel?: LifecycleLevel;
  installStage?: InstallStage;
  manufacturerId?: string;
  manufacturerName?: string;
  manufacturerPartNumber?: string;
  defaultVendorId?: string;
  defaultVendorName?: string;
  defaultLocationId?: string;
  defaultLocationName?: string;
  producedFromPartId?: string;
  producedViaStage?: InstallStage;
  unitOfMeasure: string;
  partState: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  reorderPoint: number;
  /** Populated when fetching parts with stock summary */
  quantityOnHand?: number;
  location?: string;
}

export const MOCK_PARTS: Part[] = [
  { id: 'p-1', sku: 'GG-NAVITAS-MOTOR-KIT', name: 'Motor & Controller Kit', lifecycleLevel: 'RAW_COMPONENT', category: 'DRIVE_TRAIN', installStage: 'FRAME', manufacturerName: 'Navitas', manufacturerPartNumber: '10-000891-58-P', defaultVendorName: 'Navitas', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 2, quantityOnHand: 4, location: 'B-12' },
  { id: 'p-2', sku: 'GG-FAB-4LSB-RAW', name: '4-Link Suspension', variant: 'Bent', lifecycleLevel: 'RAW_COMPONENT', category: 'FABRICATION', installStage: 'FABRICATION', manufacturerName: 'Golfin Garage', defaultVendorName: 'Golfin Garage', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 2, quantityOnHand: 3, location: 'A-04' },
  { id: 'p-3', sku: 'GG-FAB-4LSB-PREP', name: '4-Link Suspension', variant: 'Bent', lifecycleLevel: 'PREPARED_COMPONENT', category: 'FABRICATION', installStage: 'FRAME', producedFromPartId: 'p-2', producedViaStage: 'FABRICATION', manufacturerName: 'Golfin Garage', defaultVendorName: 'Golfin Garage', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 2, quantityOnHand: 1 },
  { id: 'p-4', sku: 'GG-FAB-4LSB-ASM', name: '4-Link Suspension', variant: 'Bent', lifecycleLevel: 'ASSEMBLED_COMPONENT', category: 'FABRICATION', producedFromPartId: 'p-3', producedViaStage: 'FRAME', unitOfMeasure: 'EA', partState: 'ACTIVE', reorderPoint: 1, quantityOnHand: 0 },
];

export interface ListPartsParams {
  search?: string;
  partState?: string;
  category?: PartCategory;
  installStage?: InstallStage;
  lifecycleLevel?: LifecycleLevel;
  manufacturerId?: string;
  defaultVendorId?: string;
  limit?: number;
  offset?: number;
}

export async function listParts(params?: ListPartsParams): Promise<{ items: Part[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.partState) qs.set('partState', params.partState);
  if (params?.category) qs.set('category', params.category);
  if (params?.installStage) qs.set('installStage', params.installStage);
  if (params?.lifecycleLevel) qs.set('lifecycleLevel', params.lifecycleLevel);
  if (params?.manufacturerId) qs.set('manufacturerId', params.manufacturerId);
  if (params?.defaultVendorId) qs.set('defaultVendorId', params.defaultVendorId);
  qs.set('limit', String(params?.limit ?? 25));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/inventory/parts${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_PARTS, total: MOCK_PARTS.length });
}

export async function getPart(id: string): Promise<Part | undefined> {
  return apiFetch(`/inventory/parts/${id}`, undefined, MOCK_PARTS.find((p) => p.id === id));
}

export interface PartChainNode {
  part: Part;
  producedViaStage?: InstallStage;
}

export interface PartChain {
  ancestors: PartChainNode[];
  part: Part;
  descendants: PartChainNode[];
}

export async function getPartChain(id: string): Promise<PartChain> {
  const mockPart = MOCK_PARTS.find((p) => p.id === id);
  const fallback: PartChain = mockPart
    ? { ancestors: [], part: mockPart, descendants: [] }
    : { ancestors: [], part: MOCK_PARTS[0], descendants: [] };
  return apiFetch(`/inventory/parts/${id}/chain`, undefined, fallback);
}

export interface StageMaterialPlanLine {
  part: Part;
  onHand: number;
  reorderPoint: number;
  shortfall: number;
}

export interface StageMaterialPlanGroup {
  installStage: InstallStage;
  lines: StageMaterialPlanLine[];
  totalShortfall: number;
}

export interface StageMaterialPlanResponse {
  generatedAt: string;
  groups: StageMaterialPlanGroup[];
  unassigned: StageMaterialPlanLine[];
}

export async function getMaterialPlanByStage(): Promise<StageMaterialPlanResponse> {
  const mockLines: StageMaterialPlanLine[] = MOCK_PARTS.filter((p) => p.installStage).map((p) => ({
    part: p,
    onHand: p.quantityOnHand ?? 0,
    reorderPoint: p.reorderPoint,
    shortfall: Math.max(p.reorderPoint - (p.quantityOnHand ?? 0), 0),
  }));
  const stageSet = new Set(mockLines.map((l) => l.part.installStage!));
  const groups: StageMaterialPlanGroup[] = [...stageSet].map((stage) => {
    const lines = mockLines.filter((l) => l.part.installStage === stage);
    return { installStage: stage, lines, totalShortfall: lines.reduce((sum, l) => sum + l.shortfall, 0) };
  });
  const unassigned = MOCK_PARTS.filter((p) => !p.installStage).map((p) => ({
    part: p, onHand: p.quantityOnHand ?? 0, reorderPoint: p.reorderPoint, shortfall: Math.max(p.reorderPoint - (p.quantityOnHand ?? 0), 0),
  }));
  return apiFetch(`/inventory/planning/material-by-stage`, undefined, {
    generatedAt: new Date().toISOString(), groups, unassigned,
  });
}

// ─── Manufacturers ────────────────────────────────────────────────────────────

export interface Manufacturer {
  id: string;
  manufacturerCode: string;
  name: string;
  state: 'ACTIVE' | 'INACTIVE';
  website?: string;
  notes?: string;
}

export const MOCK_MANUFACTURERS: Manufacturer[] = [
  { id: 'mfr-1', manufacturerCode: 'MFR-NAVITAS', name: 'Navitas', state: 'ACTIVE' },
  { id: 'mfr-2', manufacturerCode: 'MFR-GOLFIN-GARAGE', name: 'Golfin Garage', state: 'ACTIVE' },
];

export async function listManufacturers(state?: 'ACTIVE' | 'INACTIVE'): Promise<{ items: Manufacturer[]; total: number }> {
  const qs = state ? `?state=${state}` : '';
  return apiFetch(`/inventory/manufacturers${qs}`, undefined, { items: MOCK_MANUFACTURERS, total: MOCK_MANUFACTURERS.length });
}

export async function createManufacturer(input: { manufacturerCode: string; name: string; website?: string; notes?: string }): Promise<Manufacturer> {
  const data = await apiFetch<{ manufacturer: Manufacturer }>(`/inventory/manufacturers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.manufacturer;
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

// ─── Technician Tasks ─────────────────────────────────────────────────────────────────

export type BlockedReasonCode =
  | 'WAITING_PARTS'
  | 'WAITING_MANAGER'
  | 'TOOLING_ISSUE'
  | 'CUSTOMER_HOLD'
  | 'SAFETY_CONCERN'
  | 'OTHER';

export interface TechnicianTask {
  id: string;
  workOrderId: string;
  /** Denormalized from work order for display */
  workOrderNumber?: string;
  routingStepId: string;
  /** Denormalized from routing step for display */
  routingStepTitle?: string;
  technicianId?: string;
  state: 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  blockedReasonCode?: BlockedReasonCode;
  requiredSkillCodes?: string[];
  estimatedMinutes?: number;
  createdAt?: string;
  updatedAt: string;
}

export interface TransitionTaskInput {
  blockedReason?: string;
  blockedReasonCode?: BlockedReasonCode;
}

export const MOCK_TASKS: TechnicianTask[] = [
  {
    id: 't-1',
    workOrderId: 'wo-ex-1',
    workOrderNumber: 'WO-2024-0001',
    routingStepId: 'step-1',
    routingStepTitle: 'Battery Pack Installation',
    technicianId: 'emp-2',
    state: 'IN_PROGRESS',
    startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    requiredSkillCodes: ['ELECTRICAL', 'BATTERY'],
    estimatedMinutes: 120,
    createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 't-2',
    workOrderId: 'wo-ex-1',
    workOrderNumber: 'WO-2024-0001',
    routingStepId: 'step-2',
    routingStepTitle: 'Motor Controller Setup',
    technicianId: 'emp-2',
    state: 'BLOCKED',
    blockedReasonCode: 'WAITING_PARTS',
    blockedReason: 'Waiting on Sevcon controller — PO #4532',
    requiredSkillCodes: ['ELECTRICAL'],
    estimatedMinutes: 45,
    createdAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 't-3',
    workOrderId: 'wo-ex-2',
    workOrderNumber: 'WO-2024-0002',
    routingStepId: 'step-3',
    routingStepTitle: 'Lift Kit & Suspension Install',
    technicianId: 'emp-2',
    state: 'READY',
    requiredSkillCodes: ['SUSPENSION', 'MECHANICAL'],
    estimatedMinutes: 90,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

/** Returns headers required for state-mutating requests. */
export function mutationHeaders(): { 'X-Correlation-Id': string; 'Idempotency-Key': string } {
  return {
    'X-Correlation-Id': crypto.randomUUID(),
    'Idempotency-Key': crypto.randomUUID(),
  };
}

export async function listTechnicianTasks(params: {
  workOrderId?: string;
  technicianId?: string;
  state?: string;
  assignedOnly?: boolean;
  limit?: number;
}): Promise<{ items: TechnicianTask[] }> {
  const qs = new URLSearchParams();
  if (params.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params.technicianId) qs.set('technicianId', params.technicianId);
  if (params.state) qs.set('state', params.state);
  if (params.assignedOnly !== undefined) qs.set('assignedOnly', String(params.assignedOnly));
  if (params.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/tickets/technician-tasks${qs.size ? `?${qs}` : ''}`, undefined, { items: MOCK_TASKS });
}

export async function transitionTechnicianTask(
  id: string,
  state: TechnicianTask['state'],
  input?: TransitionTaskInput,
): Promise<TechnicianTask> {
  const existing = MOCK_TASKS.find(t => t.id === id);
  const fallback: TechnicianTask = existing
    ? { ...existing, state, ...input, updatedAt: new Date().toISOString() }
    : { id, workOrderId: '', routingStepId: '', state, updatedAt: new Date().toISOString() };
  const data = await apiFetch<{ task: TechnicianTask }>(
    `/tickets/technician-tasks/${id}/state`,
    {
      method: 'PATCH',
      body: JSON.stringify({ state, ...input }),
      headers: mutationHeaders(),
    },
    { task: fallback },
  );
  return data.task;
}

export async function blockTechnicianTask(
  id: string,
  reasonCode: string,
  reasonText: string,
  ownerId?: string,
): Promise<TechnicianTask> {
  const data = await apiFetch<{ task: TechnicianTask }>(
    `/tickets/technician-tasks/${id}/state`,
    {
      method: 'PATCH',
      body: JSON.stringify({ state: 'BLOCKED', blockedReason: reasonText, blockedReasonCode: reasonCode, ownerId }),
      headers: mutationHeaders(),
    },
  );
  return data.task;
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
  const res = await apiFetch<{ items: InvoiceSyncRecord[]; total: number }>(
    `/accounting/invoice-sync${qs.size ? `?${qs}` : ''}`,
  );
  return { items: res.items };
}

export async function retryInvoiceSync(id: string): Promise<{ id: string; state: string }> {
  return apiFetch(`/accounting/invoice-sync/${id}/retry`, { method: 'POST' });
}

export interface QbInvoiceSummary {
  id: string;
  docNumber?: string;
  totalAmount: number;
  balance: number;
  txnDate?: string;
  dueDate?: string;
  customerName?: string;
}

export interface QbOverview {
  customerCount?: number;
  openInvoiceCount?: number;
  openInvoiceBalance?: number;
  recentInvoices?: QbInvoiceSummary[];
  accountsByType?: Record<string, number>;
  accountsTotal?: number;
  error?: string;
}

export async function getQbStatus(): Promise<{
  connected: boolean;
  companyName?: string;
  realmId?: string;
  message?: string;
  overview?: QbOverview;
}> {
  return apiFetch('/accounting/status');
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

export interface ReconciliationRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  mismatchCount?: number;
  summary?: string;
}

export async function listReconciliationRuns(params?: { limit?: number }): Promise<{ items: ReconciliationRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/accounting/reconciliation/runs${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
  );
}

export interface CustomerSyncRecord {
  id: string;
  customerId: string;
  provider: string;
  state: 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'SKIPPED';
  attemptCount: number;
  lastErrorCode: string | null;
}

export async function listCustomerSyncs(params?: { state?: string; limit?: number }): Promise<{ items: CustomerSyncRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/accounting/customers${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
  );
}

export interface IntegrationAccount {
  id: string;
  name: string;
  accountType?: string;
  qbId?: string;
}

export async function listIntegrationAccounts(): Promise<{ items: IntegrationAccount[]; total: number }> {
  return apiFetch('/accounting/integration-accounts', undefined, { items: [], total: 0 });
}

export interface FailureSummary {
  invoice: number;
  customer: number;
  payment: number;
  total: number;
}

export async function getFailureSummary(): Promise<FailureSummary> {
  return apiFetch('/accounting/failures/summary', undefined, {
    invoice: 0,
    customer: 0,
    payment: 0,
    total: 0,
  });
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
  const res = await apiFetch<{ items: Dealer[]; total: number } | Dealer[]>(
    '/identity/dealers',
    undefined,
    { items: MOCK_DEALERS, total: MOCK_DEALERS.length },
  );
  return Array.isArray(res) ? res : res.items ?? [];
}

// ─── SOP Documents ────────────────────────────────────────────────────────────

export interface SopDocument {
  id: string;
  documentCode: string;
  title: string;
  documentStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  category?: string;
  ownerEmployeeId?: string;
  currentVersion?: {
    versionNumber: number;
    effectiveAt?: string;
    changeSummary?: string;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateSopInput {
  documentCode: string;
  title: string;
  category?: string;
  ownerEmployeeId?: string;
}

export async function listSops(params?: { status?: string; search?: string; limit?: number; offset?: number }): Promise<{ items: SopDocument[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sop${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function createSop(input: CreateSopInput): Promise<SopDocument> {
  const data = await apiFetch<{ sop: SopDocument }>('/sop', { method: 'POST', body: JSON.stringify(input) });
  return data.sop;
}

// ─── Training Modules ─────────────────────────────────────────────────────────

export interface OjtStep {
  id: string;
  title: string;
  instructions: string;
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnail?: string;
  tools?: string[];
  materials?: string[];
  safetyWarnings?: Array<{ severity: 'danger' | 'warning' | 'caution'; text: string }>;
  commonMistakes?: string[];
  whyItMatters?: string;
  requiresConfirmation?: boolean;
  requiresVideoCompletion?: boolean;
}

export interface OjtKnowledgeCheck {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface TrainingModule {
  id: string;
  moduleCode: string;
  moduleName: string;
  description?: string;
  moduleStatus: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  passScore?: number;
  validityDays?: number;
  isRequired: boolean;
  estimatedTime?: string;
  thumbnailUrl?: string;
  prerequisites: string[];
  jobRoles: string[];
  requiresSupervisorSignoff: boolean;
  sortOrder: number;
  steps?: OjtStep[];
  knowledgeChecks?: OjtKnowledgeCheck[];
  sopDocument?: { documentCode: string; title: string; documentStatus: string };
  createdAt: string;
  updatedAt: string;
}

export async function listTrainingModules(params?: { status?: string }): Promise<{ items: TrainingModule[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  return apiFetch(`/sop/modules${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function getTrainingModule(idOrCode: string): Promise<TrainingModule> {
  const data = await apiFetch<{ module: TrainingModule }>(`/sop/modules/${idOrCode}`);
  return data.module;
}

export interface StepProgressEntry {
  stepId: string;
  status: string;
  videoWatched: boolean;
  videoProgress: number;
  completedAt: string | null;
}

export interface ModuleProgressData {
  moduleId: string;
  employeeId: string;
  status: string;
  currentStep: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: StepProgressEntry[];
  quizAttempts: Array<{ id: string; score: number; totalQuestions: number; passed: boolean; attemptedAt: string }>;
}

export async function getModuleProgress(moduleIdOrCode: string, employeeId: string): Promise<ModuleProgressData> {
  return apiFetch(
    `/sop/modules/${moduleIdOrCode}/progress/${employeeId}`,
    undefined,
    { moduleId: moduleIdOrCode, employeeId, status: 'not-started', currentStep: null, startedAt: null, completedAt: null, steps: [], quizAttempts: [] }
  );
}

export async function updateStepProgress(
  moduleIdOrCode: string,
  params: { employeeId: string; stepId: string; status?: string; videoWatched?: boolean; videoProgress?: number; completed?: boolean }
): Promise<void> {
  await apiFetch(`/sop/modules/${moduleIdOrCode}/step-progress`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export interface QuizSubmitResult {
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  passScore: number;
  answers: Array<{ questionId: string; question: string; selectedAnswer: number; correctAnswer: number; isCorrect: boolean; explanation?: string }>;
}

export async function submitQuiz(moduleIdOrCode: string, employeeId: string, answers: number[]): Promise<QuizSubmitResult> {
  return apiFetch(`/sop/modules/${moduleIdOrCode}/quiz`, {
    method: 'POST',
    body: JSON.stringify({ employeeId, answers }),
  });
}

export interface OjtNote {
  id: string;
  moduleId: string;
  stepId?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export async function listNotes(employeeId: string, moduleId?: string): Promise<OjtNote[]> {
  const qs = new URLSearchParams({ employeeId });
  if (moduleId) qs.set('moduleId', moduleId);
  const data = await apiFetch<{ items: OjtNote[] }>(`/sop/notes?${qs}`, undefined, { items: [] });
  return data.items;
}

export async function saveNote(employeeId: string, moduleId: string, content: string, stepId?: string): Promise<void> {
  await apiFetch('/sop/notes', { method: 'POST', body: JSON.stringify({ employeeId, moduleId, stepId, content }) });
}

export async function listBookmarks(employeeId: string, moduleId?: string): Promise<Array<{ id: string; moduleId: string; stepId: string; createdAt: string }>> {
  const qs = new URLSearchParams({ employeeId });
  if (moduleId) qs.set('moduleId', moduleId);
  const data = await apiFetch<{ items: Array<{ id: string; moduleId: string; stepId: string; createdAt: string }> }>(`/sop/bookmarks?${qs}`, undefined, { items: [] });
  return data.items;
}

export async function toggleBookmark(employeeId: string, moduleId: string, stepId: string): Promise<boolean> {
  const data = await apiFetch<{ bookmarked: boolean }>('/sop/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ employeeId, moduleId, stepId }),
  });
  return data.bookmarked;
}

// ─── Training Assignments ─────────────────────────────────────────────────────

export interface TrainingAssignment {
  id: string;
  moduleId: string;
  employeeId: string;
  assignmentStatus: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXEMPT' | 'CANCELLED';
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  score?: number;
  module?: {
    moduleCode: string;
    moduleName: string;
    passScore?: number;
    validityDays?: number;
    isRequired: boolean;
    sopDocument?: { documentCode: string; title: string };
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export async function listMyAssignments(employeeId: string, params?: { status?: string }): Promise<{ items: TrainingAssignment[]; total: number }> {
  const qs = new URLSearchParams({ employeeId });
  if (params?.status) qs.set('status', params.status);
  return apiFetch(`/ojt/assignments?${qs}`, undefined, { items: [], total: 0 });
}

export async function completeAssignment(id: string, score?: number): Promise<TrainingAssignment> {
  const data = await apiFetch<{ assignment: TrainingAssignment }>(
    `/ojt/assignments/${id}/complete`,
    { method: 'PATCH', body: JSON.stringify({ score }) }
  );
  return data.assignment;
}

// ─── Inspection Templates ─────────────────────────────────────────────────────

export interface InspectionTemplateItem {
  id: string;
  name: string;
  message?: string;
  ordinal: number;
  status?: string | null;
  inspectionTemplateId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionTemplate {
  id: string;
  smId?: string | null;
  name: string;
  deleted: boolean;
  items?: InspectionTemplateItem[];
  createdAt: string;
  updatedAt: string;
}

export async function listInspectionTemplates(): Promise<{ items: InspectionTemplate[]; total: number }> {
  return apiFetch('/sop/inspection-templates', undefined, { items: [], total: 0 });
}

export async function getInspectionTemplate(id: string): Promise<InspectionTemplate> {
  const data = await apiFetch<{ template: InspectionTemplate }>(`/sop/inspection-templates/${id}`);
  return data.template;
}

// ─── Communication (Channels, Messages, Todos, Notifications) ────────────────

export interface Channel {
  id: string;
  name: string;
  type: 'TEAM' | 'WORK_ORDER' | 'CUSTOMER' | 'DIRECT';
  description: string | null;
  entityId: string | null;
  memberCount: number;
  messageCount: number;
  todoCount: number;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  parentId: string | null;
  replyCount?: number;
  attachments: { id: string; fileAttachmentId: string }[];
  reactions: { emoji: string; count: number; userIds: string[] }[];
  editedAt?: string;
  createdAt: string;
}

export interface ChannelTodo {
  id: string;
  channelId: string;
  title: string;
  status: 'OPEN' | 'DONE';
  assigneeId: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export async function listChannels(params?: { type?: string }): Promise<{ items: Channel[] }> {
  const qs = new URLSearchParams();
  if (params?.type) qs.set('type', params.type);
  return apiFetch(`/communication/channels${qs.size ? `?${qs}` : ''}`, undefined, { items: [] });
}

export async function createChannel(input: {
  name: string;
  type: Channel['type'];
  description?: string;
  entityId?: string;
  memberUserIds?: string[];
}): Promise<Channel> {
  return apiFetch('/communication/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listMessages(channelId: string, params?: { limit?: number; before?: string }): Promise<{ items: ChannelMessage[]; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.before) qs.set('before', params.before);
  return apiFetch(`/communication/channels/${channelId}/messages${qs.size ? `?${qs}` : ''}`, undefined, { items: [], hasMore: false });
}

export async function listReplies(messageId: string): Promise<{ items: ChannelMessage[] }> {
  return apiFetch(`/communication/messages/${messageId}/replies`, undefined, { items: [] });
}

export async function sendMessage(channelId: string, input: { content: string; parentId?: string }): Promise<ChannelMessage> {
  return apiFetch(`/communication/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function editMessage(messageId: string, content: string): Promise<{ id: string; content: string; editedAt: string }> {
  return apiFetch(`/communication/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteMessage(messageId: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/communication/messages/${messageId}`, { method: 'DELETE' });
}

export async function addReaction(messageId: string, emoji: string): Promise<void> {
  await apiFetch(`/communication/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export async function removeReaction(messageId: string, emoji: string): Promise<void> {
  await apiFetch(`/communication/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
}

export async function listChannelTodos(channelId: string, params?: { status?: string }): Promise<{ items: ChannelTodo[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  return apiFetch(`/communication/channels/${channelId}/todos${qs.size ? `?${qs}` : ''}`, undefined, { items: [] });
}

export async function createChannelTodo(channelId: string, input: { title: string; assigneeId?: string; dueDate?: string }): Promise<ChannelTodo> {
  return apiFetch(`/communication/channels/${channelId}/todos`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateChannelTodo(todoId: string, input: { title?: string; status?: 'OPEN' | 'DONE'; assigneeId?: string | null; dueDate?: string | null }): Promise<ChannelTodo> {
  return apiFetch(`/communication/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listNotifications(params?: { limit?: number; unreadOnly?: boolean }): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.unreadOnly) qs.set('unreadOnly', 'true');
  return apiFetch(`/communication/notifications${qs.size ? `?${qs}` : ''}`, undefined, { items: [], unreadCount: 0 });
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await apiFetch('/communication/notifications/read', {
    method: 'PATCH',
    body: JSON.stringify(ids ? { ids } : {}),
  });
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEventRecord {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listAuditEvents(params?: {
  search?: string;
  action?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AuditEventRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.action) qs.set('action', params.action);
  if (params?.entityType) qs.set('entityType', params.entityType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/audit/events${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

// ─── Build Slots (Scheduling) ──────────────────────────────────────────────────

export interface BuildSlotData {
  id: string;
  slotDate: string;
  workstationCode: string;
  state: string;
  capacityHours: number;
  usedHours: number;
  remainingHours: number;
  updatedAt: string;
}

export async function listBuildSlots(params?: {
  startDate?: string;
  endDate?: string;
  state?: string;
}): Promise<{ items: BuildSlotData[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.state) qs.set('state', params.state);
  return apiFetch(`/scheduling/slots${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SalesOpportunity {
  id: string;
  customerId: string;
  title: string;
  description: string | null;
  stage: string;
  probability: number;
  estimatedValue: number | null;
  expectedCloseDate: string | null;
  assignedToUserId: string | null;
  source: string;
  lostReason: string | null;
  wonWorkOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  opportunityId: string | null;
  customerId: string;
  status: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: QuoteLine[];
}

export interface QuoteLine {
  id: string;
  quoteId: string;
  partId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
  sortOrder: number;
}

export interface SalesActivity {
  id: string;
  opportunityId: string | null;
  customerId: string | null;
  activityType: string;
  subject: string;
  body: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface PipelineStats {
  totalOpportunities: number;
  totalValue: number;
  weightedForecast: number;
  avgDealSize: number;
  winRate: number;
  byStage: Array<{ stage: string; count: number; value: number }>;
}

export interface SalesForecastMonth {
  month: string;
  weightedValue: number;
  dealCount: number;
}

export interface SalesDashboard {
  pipelineStats: PipelineStats;
  recentActivities: SalesActivity[];
  topOpportunities: SalesOpportunity[];
}

export async function listOpportunities(
  params?: { stage?: string; customerId?: string; search?: string; limit?: number; offset?: number },
): Promise<{ items: SalesOpportunity[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.stage) qs.set('stage', params.stage);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sales/opportunities${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function getOpportunity(id: string): Promise<SalesOpportunity & { quotes: Quote[]; activities: SalesActivity[] }> {
  return apiFetch(`/sales/opportunities/${id}`);
}

export async function createOpportunity(input: {
  customerId: string; title: string; description?: string; stage?: string;
  estimatedValue?: number; expectedCloseDate?: string; source?: string;
}): Promise<SalesOpportunity> {
  return apiFetch('/sales/opportunities', { method: 'POST', body: JSON.stringify(input) });
}

export async function transitionOpportunityStage(id: string, stage: string, lostReason?: string): Promise<SalesOpportunity> {
  return apiFetch(`/sales/opportunities/${id}/stage`, { method: 'POST', body: JSON.stringify({ stage, lostReason }) });
}

export async function listQuotes(
  params?: { status?: string; customerId?: string; opportunityId?: string; limit?: number; offset?: number },
): Promise<{ items: Quote[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.opportunityId) qs.set('opportunityId', params.opportunityId);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sales/quotes${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function getQuote(id: string): Promise<Quote> {
  return apiFetch(`/sales/quotes/${id}`);
}

export async function createQuote(input: {
  customerId: string; opportunityId?: string; notes?: string; validUntil?: string;
  lines?: Array<{ partId?: string; description: string; quantity: number; unitPrice: number; discountPercent?: number }>;
}): Promise<Quote> {
  return apiFetch('/sales/quotes', { method: 'POST', body: JSON.stringify(input) });
}

export async function sendQuote(id: string): Promise<Quote> {
  return apiFetch(`/sales/quotes/${id}/send`, { method: 'POST' });
}

export async function acceptQuote(id: string): Promise<Quote> {
  return apiFetch(`/sales/quotes/${id}/accept`, { method: 'POST' });
}

export async function rejectQuote(id: string, reason?: string): Promise<Quote> {
  return apiFetch(`/sales/quotes/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function listActivities(
  params?: { opportunityId?: string; customerId?: string; activityType?: string; limit?: number; offset?: number },
): Promise<{ items: SalesActivity[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.opportunityId) qs.set('opportunityId', params.opportunityId);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.activityType) qs.set('activityType', params.activityType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sales/activities${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function createActivity(input: {
  opportunityId?: string; customerId?: string; activityType: string; subject: string; body?: string; dueDate?: string;
}): Promise<SalesActivity> {
  return apiFetch('/sales/activities', { method: 'POST', body: JSON.stringify(input) });
}

export async function getSalesPipelineStats(): Promise<PipelineStats> {
  return apiFetch('/sales/pipeline-stats', undefined, {
    totalOpportunities: 0, totalValue: 0, weightedForecast: 0, avgDealSize: 0, winRate: 0, byStage: [],
  });
}

export async function getSalesForecast(): Promise<SalesForecastMonth[]> {
  return apiFetch('/sales/forecast', undefined, []);
}

export async function getSalesDashboard(): Promise<SalesDashboard> {
  return apiFetch('/sales/dashboard', undefined, {
    pipelineStats: { totalOpportunities: 0, totalValue: 0, weightedForecast: 0, avgDealSize: 0, winRate: 0, byStage: [] },
    recentActivities: [],
    topOpportunities: [],
  });
}

// ── Sales AI Copilot ──────────────────────────────────────────────────────────

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed: string[];
  createdAt: string;
}

export interface AgentChatSession {
  id: string;
  opportunityId: string | null;
  startedAt: string;
  lastMessageAt: string;
  lastMessage: string | null;
}

export interface AgentChatResponse {
  sessionId: string;
  message: string;
  toolsUsed: string[];
}

export async function sendAgentChat(input: {
  message: string;
  sessionId?: string;
  opportunityId?: string;
}): Promise<AgentChatResponse> {
  return apiFetch('/sales/agent/chat', { method: 'POST', body: JSON.stringify(input) });
}

export async function listAgentSessions(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ items: AgentChatSession[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sales/agent/sessions${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function getAgentSession(id: string): Promise<AgentChatSession & { messages: AgentChatMessage[] }> {
  return apiFetch(`/sales/agent/sessions/${id}`);
}

// ── Global ERP Copilot ──────────────────────────────────────────────────────

export interface CopilotChatResponse {
  sessionId: string;
  message: string;
  toolsUsed: string[];
}

export interface CopilotSession {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  preview: string;
}

export async function sendCopilotChat(input: {
  message: string;
  sessionId?: string;
  context?: string;
}): Promise<CopilotChatResponse> {
  return apiFetch('/copilot/chat', { method: 'POST', body: JSON.stringify(input) });
}

export async function listCopilotSessions(): Promise<{ sessions: CopilotSession[] }> {
  return apiFetch('/copilot/sessions', undefined, { sessions: [] });
}

export async function getCopilotSession(
  id: string
): Promise<{ id: string; messages: AgentChatMessage[] }> {
  return apiFetch(`/copilot/sessions/${id}`);
}

