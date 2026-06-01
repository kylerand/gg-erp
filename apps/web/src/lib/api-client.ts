import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const IS_AUTH_MOCK = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

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

export interface ApiDataOptions {
  allowMockFallback?: boolean;
}

function shouldUseFallback<T>(fallback: T | undefined, options?: ApiDataOptions): fallback is T {
  return fallback !== undefined && ALLOW_MOCK_FALLBACK && options?.allowMockFallback !== false;
}

function warnFallback(path: string, reason: string, options?: ApiDataOptions): void {
  if (options?.allowMockFallback === false) return;
  if (typeof console !== 'undefined') {
    console.warn(`[api-client] Using mock fallback for ${path} (${reason}). Fix the API route.`);
  }
}

export async function apiFetch<T>(
  path: string,
  init?: ApiFetchInit,
  fallback?: T,
  options?: ApiDataOptions,
): Promise<T> {
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
    if (res.ok) return parseApiResponse<T>(res);

    if (res.status === 401 && IS_AUTH_MOCK) {
      if (shouldUseFallback(fallback, options)) {
        warnFallback(path, 'mock auth token rejected by local API', options);
        return fallback;
      }
      throw new Error(`Mock auth token rejected by local API: ${path}`);
    }

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
        if (retry.ok) return parseApiResponse<T>(retry);
      }
      // Refresh failed — redirect to login
      redirectToLogin();
      if (shouldUseFallback(fallback, options)) {
        warnFallback(path, 'auth refresh failed', options);
        return fallback;
      }
      throw new Error('Session expired. Redirecting to login.');
    }

    if (shouldUseFallback(fallback, options)) {
      warnFallback(path, `HTTP ${res.status}`, options);
      return fallback;
    }
    const errBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errBody.message ?? `API error ${res.status}: ${path}`);
  } catch (err) {
    const method = (fetchInit.method ?? 'GET').toUpperCase();
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const reqHeaders = (fetchInit.headers as Record<string, string> | undefined) ?? {};
    const idempotencyKey = reqHeaders['Idempotency-Key'];
    if (
      isMutation &&
      idempotencyKey &&
      !_skipQueue &&
      err instanceof TypeError &&
      typeof window !== 'undefined'
    ) {
      queueMutation(path, method, fetchInit.body as string | undefined, idempotencyKey);
      return { _queued: true } as unknown as T;
    }
    if (shouldUseFallback(fallback, options)) {
      warnFallback(path, err instanceof Error ? err.message : 'network error', options);
      return fallback;
    }
    if (err instanceof Error) throw err;
    throw new Error(`Network error calling ${path}`);
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text.trim()) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
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

export function queueMutation(
  path: string,
  method: string,
  body: string | undefined,
  idempotencyKey: string,
): void {
  if (typeof window === 'undefined') return;
  const queue = readOfflineQueue();
  if (!queue.some((item) => item.idempotencyKey === idempotencyKey)) {
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
  window.addEventListener('offline-queue:replay', () => {
    void replayOfflineQueue();
  });
}

// Auto-wire on import (no-op in SSR)
setupOfflineQueueReplay();

// ─── Workspace Today Queue ──────────────────────────────────────────────────

export type WorkspaceRole = 'technician' | 'manager' | 'parts' | 'trainer' | 'accounting' | 'admin';
export type TodaySeverity = 'P1' | 'P2' | 'P3';
export type TodayFreshness = 'LIVE' | 'STALE';
export type TodayModule =
  | 'work_orders'
  | 'inventory'
  | 'purchasing'
  | 'training'
  | 'accounting'
  | 'admin';

export interface WorkspaceTodayItem {
  id: string;
  module: TodayModule;
  severity: TodaySeverity;
  title: string;
  description: string;
  primaryHref: string;
  primaryAction: string;
  ownerRole: WorkspaceRole;
  dueAt?: string;
  sourceType: string;
  sourceId: string;
  freshness: TodayFreshness;
}

export interface WorkspaceTodayResponse {
  generatedAt: string;
  role: WorkspaceRole;
  summary: {
    p1: number;
    p2: number;
    p3: number;
    total: number;
  };
  items: WorkspaceTodayItem[];
  warnings: Array<{ source: string; message: string }>;
}

const MOCK_TODAY: WorkspaceTodayResponse = {
  generatedAt: new Date().toISOString(),
  role: 'manager',
  summary: { p1: 2, p2: 2, p3: 0, total: 4 },
  items: [
    {
      id: 'mock-blocked-work',
      module: 'work_orders',
      severity: 'P1',
      title: 'WO-002 is blocked',
      description: 'Waiting on battery pack before the build can continue.',
      primaryHref: erpRoute('blocked-work'),
      primaryAction: 'Review blocker',
      ownerRole: 'manager',
      sourceType: 'work_order',
      sourceId: 'wo-2',
      freshness: 'LIVE',
    },
    {
      id: 'mock-shortage',
      module: 'inventory',
      severity: 'P1',
      title: 'GG-FAB-4LSB-ASM below minimum',
      description: '4-Link Suspension: 0 on hand, 1 minimum.',
      primaryHref: erpRecordRoute('part', 'p-4'),
      primaryAction: 'Review part',
      ownerRole: 'parts',
      sourceType: 'part',
      sourceId: 'p-4',
      freshness: 'LIVE',
    },
    {
      id: 'mock-dispatch',
      module: 'work_orders',
      severity: 'P2',
      title: 'Task waiting for assignment',
      description: 'A ready routing step has no technician assigned.',
      primaryHref: erpRoute('dispatch-board'),
      primaryAction: 'Assign task',
      ownerRole: 'manager',
      sourceType: 'technician_task',
      sourceId: 'task-1',
      freshness: 'LIVE',
    },
    {
      id: 'mock-qb',
      module: 'accounting',
      severity: 'P2',
      title: 'INV-001 failed QuickBooks sync',
      description: 'QuickBooks connection timeout.',
      primaryHref: erpRoute('accounting-sync', { view: 'failures' }),
      primaryAction: 'Review sync',
      ownerRole: 'accounting',
      sourceType: 'invoice_sync',
      sourceId: 's-1',
      freshness: 'LIVE',
    },
  ],
  warnings: [],
};

export async function getWorkspaceToday(role?: WorkspaceRole): Promise<WorkspaceTodayResponse> {
  const qs = new URLSearchParams();
  if (role) qs.set('role', role);
  return apiFetch(`/workspace/today${qs.size ? `?${qs}` : ''}`, undefined, {
    ...MOCK_TODAY,
    role: role ?? MOCK_TODAY.role,
  });
}

// ─── Work Orders (planning schema) ───────────────────────────────────────────

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  vehicleProfile?: {
    id: string;
    displayName: string;
    vin: string;
    serialNumber: string;
    modelCode: string;
    modelYear: number;
    state: CartVehicleState | string;
    customerId: string;
  } | null;
  customerId?: string;
  customerProfile?: {
    id: string;
    displayName: string;
    fullName: string;
    companyName?: string | null;
    email: string;
    phone?: string | null;
    state: string;
  } | null;
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

export interface WorkOrderBuildPackage {
  id: string;
  buildConfigurationId: string;
  bomId: string;
  label: string;
  description: string;
  source: 'WORK_ORDER_HISTORY' | 'PLANNING_MASTER';
  workOrderCount: number;
  lastUsedAt: string;
  lastWorkOrderId?: string;
  lastWorkOrderNumber?: string;
  lastVehicleDisplayName?: string;
  lastCustomerDisplayName?: string;
  stateCounts: Record<string, number>;
}

export type BuildConfigurationStatus = 'DRAFT' | 'LOCKED' | 'RELEASED' | 'SUPERSEDED';
export type BomStatus = 'DRAFT' | 'APPROVED' | 'OBSOLETE';

export interface BuildConfiguration {
  id: string;
  configurationCode: string;
  vehicleId: string;
  vehicleDisplayName?: string;
  customerDisplayName?: string;
  configurationVersion: number;
  configurationStatus: BuildConfigurationStatus;
  selectedOptions: string[];
  notes?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BomLineInput {
  partId: string;
  quantityPerUnit: number;
  scrapFactor?: number;
  lineNote?: string;
}

export interface BomLine {
  id: string;
  bomId: string;
  partId: string;
  sku: string;
  partName: string;
  unitOfMeasure: string;
  quantityPerUnit: number;
  scrapFactor: number;
  lineNote?: string;
}

export interface BuildBom {
  id: string;
  bomCode: string;
  buildConfigurationId: string;
  configurationCode?: string;
  revision: number;
  bomStatus: BomStatus;
  notes?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines: BomLine[];
}

export interface CreateBuildConfigurationInput {
  configurationCode: string;
  vehicleId: string;
  configurationVersion?: number;
  selectedOptions?: string[];
  notes?: string;
}

export interface CreateBomInput {
  bomCode: string;
  buildConfigurationId: string;
  revision?: number;
  notes?: string;
  lines: BomLineInput[];
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

export type CreateExecutionWorkOrderInput = CreateWorkOrderInput & {
  title?: string;
  priority?: number;
  stockLocationId?: string;
};

export type CartVehicleState = 'REGISTERED' | 'IN_BUILD' | 'QUALITY_HOLD' | 'COMPLETED' | 'RETIRED';

export interface CartVehicle {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: CartVehicleState;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCartVehicleInput {
  vin?: string;
  serialNumber?: string;
  modelCode?: string;
  modelYear?: number;
  state?: CartVehicleState;
}

export const MOCK_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-1',
    workOrderNumber: 'WO-001',
    vehicleId: 'v-001',
    buildConfigurationId: 'bc-001',
    bomId: 'bom-001',
    state: 'IN_PROGRESS',
    description: 'Full cart restoration',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wo-2',
    workOrderNumber: 'WO-002',
    vehicleId: 'v-002',
    buildConfigurationId: 'bc-002',
    bomId: 'bom-002',
    state: 'BLOCKED',
    description: 'Waiting on battery pack',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wo-3',
    workOrderNumber: 'WO-003',
    vehicleId: 'v-003',
    buildConfigurationId: 'bc-001',
    bomId: 'bom-001',
    state: 'PLANNED',
    description: 'New build — Street Legal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function workOrderVehicleDisplayName(workOrder: WorkOrder): string {
  return workOrder.vehicleProfile?.displayName || 'Unresolved cart';
}

export function workOrderCustomerDisplayName(workOrder: WorkOrder): string {
  return (
    workOrder.customerProfile?.displayName?.trim() ||
    workOrder.customerProfile?.companyName?.trim() ||
    workOrder.customerProfile?.fullName ||
    workOrder.customerProfile?.email ||
    'Unresolved customer'
  );
}

export async function listWorkOrders(
  params?: {
    state?: string;
    limit?: number;
    includeBuildPackages?: boolean;
  },
  options?: ApiDataOptions,
): Promise<{ items: WorkOrder[]; total: number; buildPackages?: WorkOrderBuildPackage[] }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.includeBuildPackages) qs.set('includeBuildPackages', 'true');
  return apiFetch(
    `/planning/work-orders${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_WORK_ORDERS,
      total: MOCK_WORK_ORDERS.length,
      buildPackages: [],
    },
    options,
  );
}

export async function listBuildPackages(
  params?: { search?: string; limit?: number; offset?: number },
  options?: ApiDataOptions,
): Promise<{ items: WorkOrderBuildPackage[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/planning/build-packages${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export async function listWorkOrderBuildPackages(
  params?: { search?: string; limit?: number; offset?: number },
  options?: ApiDataOptions,
): Promise<{ items: WorkOrderBuildPackage[]; total: number }> {
  return listBuildPackages(params, options);
}

export async function listBuildConfigurations(
  params?: {
    search?: string;
    status?: BuildConfigurationStatus;
    vehicleId?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: BuildConfiguration[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.vehicleId) qs.set('vehicleId', params.vehicleId);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/planning/build-configurations${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, limit: params?.limit ?? 50, offset: params?.offset ?? 0 },
    options,
  );
}

export async function createBuildConfiguration(
  input: CreateBuildConfigurationInput,
): Promise<BuildConfiguration> {
  const data = await apiFetch<{ buildConfiguration: BuildConfiguration }>(
    '/planning/build-configurations',
    {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
  );
  return data.buildConfiguration;
}

export async function transitionBuildConfiguration(
  id: string,
  state: BuildConfigurationStatus,
): Promise<BuildConfiguration> {
  const data = await apiFetch<{ buildConfiguration: BuildConfiguration }>(
    `/planning/build-configurations/${encodeURIComponent(id)}/state`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify({ state }),
    },
  );
  return data.buildConfiguration;
}

export async function listBoms(
  params?: {
    search?: string;
    status?: BomStatus;
    buildConfigurationId?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: BuildBom[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.buildConfigurationId) qs.set('buildConfigurationId', params.buildConfigurationId);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/planning/boms${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, limit: params?.limit ?? 50, offset: params?.offset ?? 0 },
    options,
  );
}

export async function createBom(input: CreateBomInput): Promise<BuildBom> {
  const data = await apiFetch<{ bom: BuildBom }>('/planning/boms', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.bom;
}

export async function approveBom(id: string): Promise<BuildBom> {
  const data = await apiFetch<{ bom: BuildBom }>(
    `/planning/boms/${encodeURIComponent(id)}/approve`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify({}),
    },
  );
  return data.bom;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const data = await apiFetch<{ workOrder: WorkOrder }>('/planning/work-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.workOrder;
}

export async function listCartVehicles(
  params?: {
    customerId?: string;
    search?: string;
    state?: CartVehicleState;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: CartVehicle[]; total: number; limit?: number; offset?: number }> {
  const qs = new URLSearchParams();
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.search) qs.set('search', params.search);
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/planning/vehicles${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, limit: params?.limit ?? 25, offset: params?.offset ?? 0 },
    options,
  );
}

export async function updateCartVehicle(
  id: string,
  input: UpdateCartVehicleInput,
): Promise<CartVehicle> {
  const data = await apiFetch<{ vehicle: CartVehicle }>(`/planning/vehicles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.vehicle;
}

export async function transitionWorkOrderState(
  id: string,
  state: WorkOrder['state'],
): Promise<WorkOrder> {
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

export async function createExecutionWorkOrder(
  input: CreateExecutionWorkOrderInput,
): Promise<WoOrder> {
  const data = await apiFetch<{ workOrder: WoOrder }>('/tickets/work-orders', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.workOrder;
}

export interface WoOrderChecklistItem {
  id: string;
  label: string;
  done: boolean;
  operationCode?: string;
  sequenceNo?: number;
  status?: WoOperationStatus;
  requiredSkillCode?: string;
  estimatedMinutes?: number;
  blockingReason?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  updatedAt?: string;
}

export type WoOperationStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'DONE'
  | 'SKIPPED'
  | 'CANCELLED';

export type WoOrderPartStatus =
  | 'REQUESTED'
  | 'RESERVED'
  | 'PARTIALLY_CONSUMED'
  | 'CONSUMED'
  | 'SHORT'
  | 'CANCELLED';

export interface WoOrderPartLine {
  id: string;
  partId: string;
  partSku: string;
  name: string;
  qty: number;
  requestedQuantity: number;
  reservedQuantity: number;
  consumedQuantity: number;
  openQuantity: number;
  state: WoOrderPartStatus;
  reservations: InventoryReservation[];
}

export interface WoOrderNote {
  id: string;
  author: string;
  message: string;
  createdAt: string;
}

export interface WoOrderCustomerProfile {
  id: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  state: string;
  preferredContactMethod: string;
  externalReference?: string;
}

export interface WoOrderCartProfile {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: string;
}

export interface WoOrderQuoteSummary {
  id: string;
  quoteNumber: string;
  status: string;
  total: number;
  validUntil?: string;
  convertedWoId?: string;
  updatedAt: string;
}

export interface WoOrderOpportunitySummary {
  id: string;
  title: string;
  stage: string;
  probability: number;
  estimatedValue?: number;
  expectedCloseDate?: string;
  wonWorkOrderId?: string;
  updatedAt: string;
}

export interface WoOrderSalesActivitySummary {
  id: string;
  activityType: string;
  subject: string;
  body?: string;
  dueDate?: string;
  completedAt?: string;
  createdAt: string;
}

export interface WoOrderStatusHistory {
  id: string;
  fromStatus?: string;
  toStatus: string;
  reasonCode?: string;
  reasonNote?: string;
  actorUserId?: string;
  correlationId: string;
  createdAt: string;
}

export interface WoOrderDetail {
  id: string;
  number: string;
  title: string;
  customerReference?: string;
  assetReference?: string;
  customer: string;
  cart: string;
  customerProfile?: WoOrderCustomerProfile;
  cartProfile?: WoOrderCartProfile;
  commercialContext?: {
    quotes: WoOrderQuoteSummary[];
    opportunities: WoOrderOpportunitySummary[];
    activities: WoOrderSalesActivitySummary[];
  };
  bay: string;
  status: WoOrder['status'];
  eta: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'FAILED';
  materialReadiness: 'READY' | 'PARTIAL' | 'NOT_READY';
  shortageCount?: number;
  reworkLoop: number;
  checklist: WoOrderChecklistItem[];
  parts: WoOrderPartLine[];
  reservations: InventoryReservation[];
  notes: WoOrderNote[];
  statusHistory?: WoOrderStatusHistory[];
}

export const MOCK_WO_ORDERS: WoOrder[] = [
  {
    id: 'wo-ex-1',
    workOrderNumber: 'WO-2024-0001',
    title: 'Club Car DS Full Build — Lifted Off-Road',
    customerReference: 'CUST-DEMO-001',
    status: 'READY',
    priority: 2,
    openedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const MOCK_WO_ORDER_DETAIL: WoOrderDetail = {
  id: 'wo-ex-1',
  number: 'WO-2024-0001',
  title: 'Club Car DS Full Build — Lifted Off-Road',
  customerReference: 'CUST-DEMO-001',
  assetReference: 'CART-001-2019-CC-DS',
  customer: 'CUST-DEMO-001',
  cart: 'Club Car DS',
  commercialContext: { quotes: [], opportunities: [], activities: [] },
  bay: 'Main Shop',
  status: 'READY',
  eta: 'No due date',
  syncStatus: 'SYNCED',
  materialReadiness: 'READY',
  reworkLoop: 0,
  checklist: [
    { id: 'op-1', label: 'Frame inspection', done: true },
    { id: 'op-2', label: 'Parts staging', done: false },
    { id: 'op-3', label: 'Final QC', done: false },
  ],
  parts: [
    {
      id: 'part-1',
      partId: 'part-1',
      partSku: 'LIFT-KIT',
      name: 'Lift kit',
      qty: 1,
      requestedQuantity: 1,
      reservedQuantity: 0,
      consumedQuantity: 0,
      openQuantity: 1,
      state: 'REQUESTED',
      reservations: [],
    },
    {
      id: 'part-2',
      partId: 'part-2',
      partSku: 'WHEEL-SET',
      name: 'Wheel set',
      qty: 1,
      requestedQuantity: 1,
      reservedQuantity: 1,
      consumedQuantity: 0,
      openQuantity: 0,
      state: 'RESERVED',
      reservations: [],
    },
  ],
  reservations: [],
  notes: [],
};

export async function listWoOrders(
  params?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: WoOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/tickets/work-orders${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_WO_ORDERS,
      total: MOCK_WO_ORDERS.length,
    },
    options,
  );
}

export async function getWoOrder(
  id: string,
  options?: ApiDataOptions,
): Promise<WoOrderDetail | null> {
  const data = await apiFetch<{ workOrder: WoOrderDetail }>(
    `/tickets/wo-queue/${id}`,
    undefined,
    {
      workOrder: { ...MOCK_WO_ORDER_DETAIL, id },
    },
    options,
  );
  return data.workOrder;
}

export interface TransitionWoOperationInput {
  status: WoOperationStatus;
  blockingReason?: string;
  reasonCode?: string;
  reasonNote?: string;
  actorUserId?: string;
}

export interface TransitionWoOperationResponse {
  operation: WoOrderChecklistItem;
  workOrder: {
    id: string;
    status: WoOrder['status'];
    completedAt?: string;
    updatedAt?: string;
  };
}

export async function transitionWoOperation(
  workOrderId: string,
  operationId: string,
  input: TransitionWoOperationInput,
  options?: ApiDataOptions,
): Promise<TransitionWoOperationResponse> {
  return apiFetch<TransitionWoOperationResponse>(
    `/tickets/work-orders/${workOrderId}/operations/${operationId}/state`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
    undefined,
    options,
  );
}

// ─── Work Order Labor + QC Execution ───────────────────────────────────────

export type LaborTimeEntrySource = 'AUTO' | 'MANUAL' | 'ADJUSTED';

export interface LaborTimeEntry {
  id: string;
  technicianTaskId?: string;
  workOrderId: string;
  technicianId: string;
  startedAt: string;
  endedAt?: string;
  manualHours?: number;
  description?: string;
  source: LaborTimeEntrySource;
  computedHours: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateLaborTimeEntryInput {
  technicianTaskId?: string;
  workOrderId: string;
  technicianId: string;
  startedAt: string;
  endedAt?: string;
  manualHours?: number;
  description?: string;
  source?: LaborTimeEntrySource;
}

type TimeEntriesResponse = { items?: LaborTimeEntry[]; entries?: LaborTimeEntry[] };

function normalizeTimeEntries(data: TimeEntriesResponse): LaborTimeEntry[] {
  return Array.isArray(data.items) ? data.items : Array.isArray(data.entries) ? data.entries : [];
}

export async function listWorkOrderTimeEntries(
  workOrderId: string,
  options?: ApiDataOptions,
): Promise<LaborTimeEntry[]> {
  const qs = new URLSearchParams({ workOrderId });
  const data = await apiFetch<TimeEntriesResponse>(
    `/tickets/time-entries?${qs}`,
    undefined,
    { entries: [] },
    options,
  );
  return normalizeTimeEntries(data);
}

export async function createLaborTimeEntry(
  input: CreateLaborTimeEntryInput,
): Promise<LaborTimeEntry> {
  const data = await apiFetch<{ entry: LaborTimeEntry }>('/tickets/time-entries', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.entry;
}

export type QcGateResult = 'PASS' | 'FAIL' | 'NA';
export type QcOverallResult = 'PASSED' | 'FAILED';

export interface WorkOrderQcGate {
  id: string;
  workOrderId: string;
  taskId?: string;
  gateLabel: string;
  isCritical: boolean;
  result: QcGateResult | null;
  failureNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface SubmitQcGateResultInput {
  gateLabel: string;
  isCritical: boolean;
  result: QcGateResult;
  failureNote?: string;
}

export interface SubmitWorkOrderQcInput {
  taskId?: string;
  reviewedBy: string;
  results: SubmitQcGateResultInput[];
}

export interface SubmitWorkOrderQcResponse {
  status?: QcOverallResult;
  overallResult?: QcOverallResult;
  openReworkCount?: number;
  reworkIssuesCreated?: number;
  activeReworkLoopCount?: number;
  gates: WorkOrderQcGate[];
}

export async function listWorkOrderQcGates(
  workOrderId: string,
  params?: { taskId?: string },
  options?: ApiDataOptions,
): Promise<WorkOrderQcGate[]> {
  const qs = new URLSearchParams();
  if (params?.taskId) qs.set('taskId', params.taskId);
  const data = await apiFetch<{ gates: WorkOrderQcGate[] }>(
    `/tickets/work-orders/${workOrderId}/qc-gates${qs.size ? `?${qs}` : ''}`,
    undefined,
    { gates: [] },
    options,
  );
  return data.gates;
}

export async function submitWorkOrderQcGates(
  workOrderId: string,
  input: SubmitWorkOrderQcInput,
): Promise<SubmitWorkOrderQcResponse> {
  return apiFetch<SubmitWorkOrderQcResponse>(
    `/tickets/work-orders/${workOrderId}/qc-gates/batch-submit`,
    {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ workOrderId, ...input }),
    },
  );
}

// ─── Customers ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
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
  billingAddress?: string;
  shippingAddress?: string;
  preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS';
}

export interface UpdateCustomerInput {
  fullName?: string;
  email?: string;
  companyName?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  preferredContactMethod?: Customer['preferredContactMethod'];
  externalReference?: string | null;
}

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 'c-1',
    fullName: 'John Smith',
    email: 'john@example.com',
    state: 'ACTIVE',
    preferredContactMethod: 'EMAIL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'c-2',
    fullName: 'Riverside Golf Club',
    companyName: 'Riverside Golf Club LLC',
    email: 'ops@riverside.com',
    state: 'ACTIVE',
    preferredContactMethod: 'EMAIL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'c-3',
    fullName: 'New Lead Corp',
    email: 'lead@example.com',
    state: 'LEAD',
    preferredContactMethod: 'PHONE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function listCustomers(
  params?: {
    state?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: Customer[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.search) qs.set('search', params.search);
  qs.set('limit', String(params?.limit ?? 25));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/identity/customers${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_CUSTOMERS,
      total: MOCK_CUSTOMERS.length,
    },
    options,
  );
}

export async function getCustomer(id: string, options?: ApiDataOptions): Promise<Customer> {
  const data = await apiFetch<{ customer: Customer }>(
    `/identity/customers/${id}`,
    undefined,
    { customer: MOCK_CUSTOMERS.find((customer) => customer.id === id) ?? MOCK_CUSTOMERS[0] },
    options,
  );
  return data.customer;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const data = await apiFetch<{ customer: Customer }>('/identity/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.customer;
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
  const data = await apiFetch<{ customer: Customer }>(`/identity/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.customer;
}

export async function transitionCustomerState(
  id: string,
  state: Customer['state'],
): Promise<Customer> {
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

export type InstallStage = 'FABRICATION' | 'FRAME' | 'WIRING' | 'PARTS_PREP' | 'FINAL_ASSEMBLY';

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
  quantityReserved?: number;
  quantityAllocated?: number;
  quantityConsumed?: number;
  quantityAvailable?: number;
  location?: string;
}

export type PartState = Part['partState'];
export type PartStockFilter = 'OUT';

export const MOCK_PARTS: Part[] = [
  {
    id: 'p-1',
    sku: 'GG-NAVITAS-MOTOR-KIT',
    name: 'Motor & Controller Kit',
    lifecycleLevel: 'RAW_COMPONENT',
    category: 'DRIVE_TRAIN',
    installStage: 'FRAME',
    manufacturerName: 'Navitas',
    manufacturerPartNumber: '10-000891-58-P',
    defaultVendorName: 'Navitas',
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 2,
    quantityOnHand: 4,
    location: 'B-12',
  },
  {
    id: 'p-2',
    sku: 'GG-FAB-4LSB-RAW',
    name: '4-Link Suspension',
    variant: 'Bent',
    lifecycleLevel: 'RAW_COMPONENT',
    category: 'FABRICATION',
    installStage: 'FABRICATION',
    manufacturerName: 'Golfin Garage',
    defaultVendorName: 'Golfin Garage',
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 2,
    quantityOnHand: 3,
    location: 'A-04',
  },
  {
    id: 'p-3',
    sku: 'GG-FAB-4LSB-PREP',
    name: '4-Link Suspension',
    variant: 'Bent',
    lifecycleLevel: 'PREPARED_COMPONENT',
    category: 'FABRICATION',
    installStage: 'FRAME',
    producedFromPartId: 'p-2',
    producedViaStage: 'FABRICATION',
    manufacturerName: 'Golfin Garage',
    defaultVendorName: 'Golfin Garage',
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 2,
    quantityOnHand: 1,
  },
  {
    id: 'p-4',
    sku: 'GG-FAB-4LSB-ASM',
    name: '4-Link Suspension',
    variant: 'Bent',
    lifecycleLevel: 'ASSEMBLED_COMPONENT',
    category: 'FABRICATION',
    producedFromPartId: 'p-3',
    producedViaStage: 'FRAME',
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 1,
    quantityOnHand: 0,
  },
];

export interface ListPartsParams {
  search?: string;
  partState?: PartState;
  stock?: PartStockFilter;
  category?: PartCategory;
  installStage?: InstallStage;
  lifecycleLevel?: LifecycleLevel;
  manufacturerId?: string;
  defaultVendorId?: string;
  limit?: number;
  offset?: number;
}

export async function listParts(
  params?: ListPartsParams,
  options?: ApiDataOptions,
): Promise<{ items: Part[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.partState) qs.set('partState', params.partState);
  if (params?.stock) qs.set('stock', params.stock);
  if (params?.category) qs.set('category', params.category);
  if (params?.installStage) qs.set('installStage', params.installStage);
  if (params?.lifecycleLevel) qs.set('lifecycleLevel', params.lifecycleLevel);
  if (params?.manufacturerId) qs.set('manufacturerId', params.manufacturerId);
  if (params?.defaultVendorId) qs.set('defaultVendorId', params.defaultVendorId);
  qs.set('limit', String(params?.limit ?? 25));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/inventory/parts${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_PARTS,
      total: MOCK_PARTS.length,
    },
    options,
  );
}

export interface CreatePartInput {
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  reorderPoint?: number;
}

export interface UpdatePartInput {
  defaultVendorId?: string | null;
}

export async function createPart(input: CreatePartInput): Promise<Part> {
  const data = await apiFetch<{ part: Part }>('/inventory/parts', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.part;
}

export async function updatePart(
  id: string,
  input: UpdatePartInput,
  options?: ApiDataOptions,
): Promise<Part> {
  const data = await apiFetch<{ part: Part }>(
    `/inventory/parts/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
    undefined,
    options,
  );
  return data.part;
}

export async function getPart(id: string): Promise<Part | undefined> {
  return apiFetch(
    `/inventory/parts/${id}`,
    undefined,
    MOCK_PARTS.find((p) => p.id === id),
  );
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
  reserved?: number;
  available?: number;
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
  replenishment?: ReplenishmentPlan;
}

export interface ReplenishmentRecommendation {
  part: Part;
  vendorId?: string;
  vendorName?: string;
  vendorState?: 'ACTIVE' | 'INACTIVE';
  leadTimeDays?: number;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  inboundQuantity: number;
  draftQuantity: number;
  projectedAvailable: number;
  shortfall: number;
  recommendedOrderQuantity: number;
  openPurchaseOrderCount: number;
  nextExpectedAt?: string;
  estimatedUnitCost?: number;
  severity: 'critical' | 'high' | 'medium';
  reason: string;
}

export interface ReplenishmentVendorGroup {
  vendorId?: string;
  vendorName: string;
  vendorState?: 'ACTIVE' | 'INACTIVE';
  leadTimeDays?: number;
  recommendations: ReplenishmentRecommendation[];
  totalRecommendedQuantity: number;
  estimatedSubtotal: number;
}

export interface ReplenishmentPlan {
  summary: {
    recommendationCount: number;
    vendorGroupCount: number;
    partsNeedingVendor: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    totalRecommendedQuantity: number;
    estimatedCost: number;
  };
  recommendations: ReplenishmentRecommendation[];
  vendorGroups: ReplenishmentVendorGroup[];
}

export async function getMaterialPlanByStage(
  options?: ApiDataOptions,
): Promise<StageMaterialPlanResponse> {
  const mockLines: StageMaterialPlanLine[] = MOCK_PARTS.filter((p) => p.installStage).map((p) => ({
    part: p,
    onHand: p.quantityOnHand ?? 0,
    reserved: 0,
    available: p.quantityOnHand ?? 0,
    reorderPoint: p.reorderPoint,
    shortfall: Math.max(p.reorderPoint - (p.quantityOnHand ?? 0), 0),
  }));
  const stageSet = new Set(mockLines.map((l) => l.part.installStage!));
  const groups: StageMaterialPlanGroup[] = [...stageSet].map((stage) => {
    const lines = mockLines.filter((l) => l.part.installStage === stage);
    return {
      installStage: stage,
      lines,
      totalShortfall: lines.reduce((sum, l) => sum + l.shortfall, 0),
    };
  });
  const unassigned = MOCK_PARTS.filter((p) => !p.installStage).map((p) => ({
    part: p,
    onHand: p.quantityOnHand ?? 0,
    reserved: 0,
    available: p.quantityOnHand ?? 0,
    reorderPoint: p.reorderPoint,
    shortfall: Math.max(p.reorderPoint - (p.quantityOnHand ?? 0), 0),
  }));
  return apiFetch(
    `/inventory/planning/material-by-stage`,
    undefined,
    {
      generatedAt: new Date().toISOString(),
      groups,
      unassigned,
      replenishment: {
        summary: {
          recommendationCount: 0,
          vendorGroupCount: 0,
          partsNeedingVendor: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          totalRecommendedQuantity: 0,
          estimatedCost: 0,
        },
        recommendations: [],
        vendorGroups: [],
      },
    },
    options,
  );
}

// ─── Inventory Lots & Reservations ──────────────────────────────────────────

export interface InventoryLot {
  id: string;
  lotNumber: string;
  serialNumber?: string;
  lotState: 'AVAILABLE' | 'QUARANTINED' | 'CONSUMED' | 'CLOSED';
  partSku: string;
  partName: string;
  stockLocationId: string;
  locationName: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAllocated: number;
  quantityConsumed: number;
  quantityAvailable: number;
  receivedAt: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListInventoryLotsParams {
  partNumber?: string;
  warehouseId?: string;
  status?: InventoryLot['lotState'];
  page?: number;
  pageSize?: number;
}

export async function listInventoryLots(
  params?: ListInventoryLotsParams,
  options?: ApiDataOptions,
): Promise<{ items: InventoryLot[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams();
  if (params?.partNumber) qs.set('partNumber', params.partNumber);
  if (params?.warehouseId) qs.set('warehouseId', params.warehouseId);
  if (params?.status) qs.set('status', params.status);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  return apiFetch(
    `/inventory/lots${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, page: params?.page ?? 1, pageSize: params?.pageSize ?? 50 },
    options,
  );
}

export type InventoryReservationStatus =
  | 'ACTIVE'
  | 'PARTIALLY_CONSUMED'
  | 'CONSUMED'
  | 'RELEASED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface InventoryReservation {
  id: string;
  status: InventoryReservationStatus;
  reservedQuantity: number;
  consumedQuantity: number;
  allocatedQuantity: number;
  openQuantity: number;
  reservationPriority: number;
  shortageReason?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  partId: string;
  partSku: string;
  partName: string;
  unitOfMeasure: string;
  stockLocationId: string;
  locationName: string;
  stockLotId?: string;
  lotNumber?: string;
  serialNumber?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  workOrderTitle?: string;
  workOrderPartId?: string;
}

export interface ListInventoryReservationsParams {
  status?: InventoryReservationStatus | 'OPEN' | 'ALL';
  workOrderId?: string;
  partId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listInventoryReservations(
  params?: ListInventoryReservationsParams,
  options?: ApiDataOptions,
): Promise<{ items: InventoryReservation[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params?.partId) qs.set('partId', params.partId);
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  return apiFetch(
    `/inventory/reservations${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, page: params?.page ?? 1, pageSize: params?.pageSize ?? 50 },
    options,
  );
}

export interface CreateInventoryReservationInput {
  stockLotId: string;
  quantity: number;
  workOrderId?: string;
  workOrderPartId?: string;
  expiresAt?: string;
  priority?: number;
}

export async function createInventoryReservation(
  input: CreateInventoryReservationInput,
): Promise<InventoryReservation> {
  const data = await apiFetch<{ reservation: InventoryReservation }>('/inventory/reservations', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.reservation;
}

export async function releaseInventoryReservation(
  id: string,
  quantity?: number,
): Promise<InventoryReservation> {
  const data = await apiFetch<{ reservation: InventoryReservation }>(
    `/inventory/reservations/${id}/release`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify(quantity === undefined ? {} : { quantity }),
    },
  );
  return data.reservation;
}

export async function consumeInventoryReservation(
  id: string,
  quantity?: number,
): Promise<InventoryReservation> {
  const data = await apiFetch<{ reservation: InventoryReservation }>(
    `/inventory/reservations/${id}/consume`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify(quantity === undefined ? {} : { quantity }),
    },
  );
  return data.reservation;
}

export interface InventoryAdjustment {
  id: string;
  adjustmentNumber: string;
  adjustmentType: string;
  status: string;
  stockLocationId: string;
  locationName: string;
  stockLotId: string;
  lotNumber?: string;
  partId: string;
  partSku: string;
  partName: string;
  quantityDelta: number;
  expectedQuantity: number;
  countedQuantity: number;
  reasonCode: string;
  notes?: string;
  ledgerEntryId: string;
  postedAt: string;
  correlationId: string;
}

export interface CreateInventoryAdjustmentInput {
  stockLotId: string;
  quantityDelta: number;
  reasonCode: string;
  notes?: string;
}

export async function createInventoryAdjustment(
  input: CreateInventoryAdjustmentInput,
): Promise<InventoryAdjustment> {
  const data = await apiFetch<{ adjustment: InventoryAdjustment }>('/inventory/adjustments', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.adjustment;
}

export interface InventoryLocation {
  id: string;
  locationCode: string;
  locationName: string;
  locationType: string;
  isPickable: boolean;
}

export async function listInventoryLocations(
  options?: ApiDataOptions,
): Promise<{ items: InventoryLocation[]; total: number }> {
  return apiFetch(
    '/inventory/locations',
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export interface InventoryTransfer {
  id: string;
  transferNumber: string;
  status: string;
  fromStockLocationId: string;
  fromLocationName: string;
  toStockLocationId: string;
  toLocationName: string;
  fromStockLotId: string;
  toStockLotId: string;
  sourceLotNumber?: string;
  destinationLotNumber: string;
  partId: string;
  partSku: string;
  partName: string;
  quantity: number;
  reasonCode?: string;
  notes?: string;
  transferOutLedgerEntryId: string;
  transferInLedgerEntryId: string;
  shippedAt: string;
  receivedAt: string;
  correlationId: string;
}

export interface CreateInventoryTransferInput {
  stockLotId: string;
  quantity: number;
  toStockLocationId: string;
  reasonCode?: string;
  notes?: string;
}

export async function createInventoryTransfer(
  input: CreateInventoryTransferInput,
): Promise<InventoryTransfer> {
  const data = await apiFetch<{ transfer: InventoryTransfer }>('/inventory/transfers', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.transfer;
}

export interface CreateCycleCountLineInput {
  stockLotId: string;
  countedQuantity: number;
  reasonCode?: string;
}

export interface CreateCycleCountInput {
  stockLocationId: string;
  scheduledFor?: string;
  notes?: string;
  tolerancePercent?: number;
  supervisorOverrideActorId?: string;
  lines: CreateCycleCountLineInput[];
}

export interface CycleCountLine {
  stockLotId: string;
  lotNumber?: string;
  partId: string;
  partSku: string;
  partName: string;
  expectedQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
  reasonCode: string;
  ledgerEntryId?: string;
  adjustmentLineId?: string;
}

export interface CycleCount {
  id: string;
  cycleCountNumber: string;
  status: string;
  stockLocationId: string;
  locationName: string;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  notes?: string;
  lineCount: number;
  varianceCount: number;
  netQuantityDelta: number;
  adjustmentId?: string;
  adjustmentNumber?: string;
  ledgerEntryIds: string[];
  lines: CycleCountLine[];
  correlationId: string;
}

export async function createCycleCount(input: CreateCycleCountInput): Promise<CycleCount> {
  const data = await apiFetch<{ cycleCount: CycleCount }>('/inventory/cycle-counts', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.cycleCount;
}

export type InventoryLedgerMovementType =
  | 'RECEIPT'
  | 'RESERVATION'
  | 'ALLOCATION'
  | 'RELEASE'
  | 'ISSUE'
  | 'RETURN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT'
  | 'CYCLE_COUNT'
  | 'REVERSAL';

export interface InventoryLedgerEntry {
  id: string;
  movementType: InventoryLedgerMovementType | string;
  quantityDelta: number;
  unitCost?: number;
  valueDelta?: number;
  reasonCode: string;
  sourceDocument?: { type: string; id: string };
  correlationId: string;
  createdAt: string;
  part: {
    id: string;
    sku: string;
    name: string;
    unitOfMeasure: string;
  };
  location: {
    id: string;
    name: string;
  };
  lot?: {
    id?: string | null;
    lotNumber?: string | null;
  };
  workOrder?: {
    id?: string | null;
    number?: string | null;
  };
  purchaseOrder?: {
    id?: string | null;
    number?: string | null;
    lineId?: string | null;
  };
}

export interface InventoryLedgerSummary {
  movementType: InventoryLedgerMovementType | string;
  entryCount: number;
  quantityDelta: number;
  valueDelta: number;
}

export interface ListInventoryLedgerParams {
  search?: string;
  movementType?: InventoryLedgerMovementType | string;
  partId?: string;
  stockLocationId?: string;
  stockLotId?: string;
  workOrderId?: string;
  sourceDocumentId?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listInventoryLedger(
  params?: ListInventoryLedgerParams,
  options?: ApiDataOptions,
): Promise<{
  items: InventoryLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
  summary: InventoryLedgerSummary[];
}> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.movementType) qs.set('movementType', params.movementType);
  if (params?.partId) qs.set('partId', params.partId);
  if (params?.stockLocationId) qs.set('stockLocationId', params.stockLocationId);
  if (params?.stockLotId) qs.set('stockLotId', params.stockLotId);
  if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params?.sourceDocumentId) qs.set('sourceDocumentId', params.sourceDocumentId);
  if (params?.correlationId) qs.set('correlationId', params.correlationId);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  qs.set('limit', String(params?.limit ?? 50));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/inventory/ledger${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, limit: params?.limit ?? 50, offset: params?.offset ?? 0, summary: [] },
    options,
  );
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

export async function listManufacturers(
  state?: 'ACTIVE' | 'INACTIVE',
): Promise<{ items: Manufacturer[]; total: number }> {
  const qs = state ? `?state=${state}` : '';
  return apiFetch(`/inventory/manufacturers${qs}`, undefined, {
    items: MOCK_MANUFACTURERS,
    total: MOCK_MANUFACTURERS.length,
  });
}

export async function createManufacturer(input: {
  manufacturerCode: string;
  name: string;
  website?: string;
  notes?: string;
}): Promise<Manufacturer> {
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
  purchaseOrderCount?: number;
  openPurchaseOrderCount?: number;
  nextExpectedAt?: string;
}

export const MOCK_VENDORS: Vendor[] = [
  {
    id: 'v-1',
    vendorCode: 'MADJAX',
    vendorName: 'MadJax Golf Cart Parts',
    vendorState: 'ACTIVE',
    email: 'orders@madjax.com',
    leadTimeDays: 5,
    paymentTerms: 'NET30',
  },
];

export async function listVendors(
  params?: { state?: Vendor['vendorState']; limit?: number; offset?: number },
  options?: ApiDataOptions,
): Promise<{ items: Vendor[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/inventory/vendors${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_VENDORS,
      total: MOCK_VENDORS.length,
    },
    options,
  );
}

export async function getVendor(id: string, options?: ApiDataOptions): Promise<Vendor> {
  const data = await apiFetch<{ vendor: Vendor }>(
    `/inventory/vendors/${encodeURIComponent(id)}`,
    undefined,
    { vendor: MOCK_VENDORS[0] },
    options,
  );
  return data.vendor;
}

export interface PurchaseOrderLine {
  id: string;
  lineNumber: number;
  partId: string;
  partSku?: string;
  partName?: string;
  defaultLocationId?: string;
  defaultLocationName?: string;
  orderedQuantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  openQuantity: number;
  unitOfMeasure?: string;
  unitOfMeasureName?: string;
  unitCost: number;
  lineTotal?: number;
  promisedAt?: string;
  lineState: string;
}

export type PurchaseOrderState =
  | 'DRAFT'
  | 'APPROVED'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  purchaseOrderState: PurchaseOrderState;
  orderedAt: string;
  expectedAt?: string;
  sentAt?: string;
  closedAt?: string;
  notes?: string;
  lineCount: number;
  lines: PurchaseOrderLine[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseOrderLineInput {
  id?: string;
  partId: string;
  orderedQuantity: number;
  unitCost: number;
  unitOfMeasureId?: string;
  promisedAt?: string | null;
}

export interface CreatePurchaseOrderInput {
  poNumber?: string;
  vendorId: string;
  expectedAt?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLineInput[];
}

export interface UpdatePurchaseOrderInput {
  vendorId?: string;
  expectedAt?: string | null;
  notes?: string | null;
  lines?: PurchaseOrderLineInput[];
}

export async function listPurchaseOrders(
  params?: {
    status?: string;
    vendorId?: string;
    page?: number;
    pageSize?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: PurchaseOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.vendorId) qs.set('vendorId', params.vendorId);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  return apiFetch(
    `/inventory/purchase-orders${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
    },
    options,
  );
}

export async function getPurchaseOrder(
  id: string,
  options?: ApiDataOptions,
): Promise<PurchaseOrder> {
  const data = await apiFetch<{ purchaseOrder: PurchaseOrder }>(
    `/inventory/purchase-orders/${encodeURIComponent(id)}`,
    undefined,
    undefined,
    options,
  );
  return data.purchaseOrder;
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const data = await apiFetch<{ purchaseOrder: PurchaseOrder }>('/inventory/purchase-orders', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
  return data.purchaseOrder;
}

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrder> {
  const data = await apiFetch<{ purchaseOrder: PurchaseOrder }>(
    `/inventory/purchase-orders/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
  );
  return data.purchaseOrder;
}

async function transitionPurchaseOrder(
  id: string,
  action: 'approve' | 'send' | 'cancel' | 'close',
): Promise<PurchaseOrder> {
  const data = await apiFetch<{ purchaseOrder: PurchaseOrder }>(
    `/inventory/purchase-orders/${encodeURIComponent(id)}/${action}`,
    {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify({}),
    },
  );
  return data.purchaseOrder;
}

export function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return transitionPurchaseOrder(id, 'approve');
}

export function sendPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return transitionPurchaseOrder(id, 'send');
}

export function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return transitionPurchaseOrder(id, 'cancel');
}

export function closePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return transitionPurchaseOrder(id, 'close');
}

export interface ReceiveInventoryLotInput {
  purchaseOrderId?: string;
  purchaseOrderLineId: string;
  quantity: number;
  rejectedQuantity?: number;
  stockLocationId?: string;
  lotNumber?: string;
  serialNumber?: string;
  receivedAt?: string;
  expiresAt?: string;
}

export async function receiveInventoryLot(input: ReceiveInventoryLotInput): Promise<{
  lot?: InventoryLot;
  purchaseOrderLine: {
    id: string;
    lineState: string;
    receivedQuantity: number;
    rejectedQuantity: number;
  };
  purchaseOrderState: PurchaseOrder['purchaseOrderState'];
}> {
  return apiFetch('/inventory/lots', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

// ─── Employees / Technicians ──────────────────────────────────────────────────

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  employmentState: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  hireDate: string;
  skills?: string[];
}

export async function listEmployees(
  params?: {
    employmentState?: string;
  },
  options?: ApiDataOptions,
): Promise<{ items: Employee[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.employmentState) qs.set('state', params.employmentState);
  return apiFetch(
    `/hr/employees${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
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
  workOrderTitle?: string;
  routingStepId: string;
  /** Denormalized from routing step for display */
  routingStepTitle?: string;
  routingStepCode?: string;
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

export async function listTechnicianTasks(
  params: {
    workOrderId?: string;
    technicianId?: string;
    state?: string;
    assignedOnly?: boolean;
    limit?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: TechnicianTask[] }> {
  const qs = new URLSearchParams();
  if (params.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params.technicianId) qs.set('technicianId', params.technicianId);
  if (params.state) qs.set('state', params.state);
  if (params.assignedOnly !== undefined) qs.set('assignedOnly', String(params.assignedOnly));
  if (params.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/tickets/technician-tasks${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: MOCK_TASKS,
    },
    options,
  );
}

export async function transitionTechnicianTask(
  id: string,
  state: TechnicianTask['state'],
  input?: TransitionTaskInput,
): Promise<TechnicianTask> {
  const existing = MOCK_TASKS.find((t) => t.id === id);
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
  const data = await apiFetch<{ task: TechnicianTask }>(`/tickets/technician-tasks/${id}/state`, {
    method: 'PATCH',
    body: JSON.stringify({
      state: 'BLOCKED',
      blockedReason: reasonText,
      blockedReasonCode: reasonCode,
      ownerId,
    }),
    headers: mutationHeaders(),
  });
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
  workOrder?: {
    id: string;
    workOrderNumber: string;
    state: string;
    scheduledStartAt?: string | null;
  } | null;
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
  {
    id: 's-1',
    invoiceNumber: 'INV-001',
    workOrderId: 'wo-ex-1',
    provider: 'QUICKBOOKS',
    state: 'FAILED',
    attemptCount: 3,
    lastErrorMessage: 'QB connection timeout',
    createdAt: new Date().toISOString(),
  },
  {
    id: 's-2',
    invoiceNumber: 'INV-002',
    workOrderId: 'wo-ex-1',
    provider: 'QUICKBOOKS',
    state: 'SYNCED',
    attemptCount: 1,
    externalReference: 'QB-INV-12345',
    createdAt: new Date().toISOString(),
  },
];

export async function listInvoiceSyncRecords(
  params?: {
    state?: string;
    workOrderId?: string;
    limit?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: InvoiceSyncRecord[] }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params?.limit) qs.set('limit', String(params.limit));
  const res = await apiFetch<{ items: InvoiceSyncRecord[]; total: number }>(
    `/accounting/invoice-sync${qs.size ? `?${qs}` : ''}`,
    undefined,
    undefined,
    options,
  );
  return { items: res.items };
}

export function invoiceSyncWorkOrderDisplayName(record: InvoiceSyncRecord): string {
  return record.workOrder?.workOrderNumber || 'Unresolved work order';
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

export interface QbCustomerSummary {
  id: string;
  displayName: string;
  companyName?: string;
  active: boolean;
}

export interface QbAccountSummary {
  id: string;
  name: string;
  accountType: string;
  accountSubType?: string;
  active: boolean;
}

export interface QbOverview {
  customerCount?: number;
  customers?: QbCustomerSummary[];
  openInvoiceCount?: number;
  openInvoiceBalance?: number;
  recentInvoices?: QbInvoiceSummary[];
  accounts?: QbAccountSummary[];
  accountsByType?: Record<string, number>;
  accountsTotal?: number;
  error?: string;
}

export async function getQbStatus(options?: ApiDataOptions): Promise<{
  connected: boolean;
  companyName?: string;
  realmId?: string;
  message?: string;
  overview?: QbOverview;
}> {
  return apiFetch<{
    connected: boolean;
    companyName?: string;
    realmId?: string;
    message?: string;
    overview?: QbOverview;
  }>('/accounting/status', undefined, undefined, options);
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

export async function listReconciliationRuns(
  params?: {
    limit?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: ReconciliationRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/accounting/reconciliation/runs${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
    },
    options,
  );
}

export interface CustomerSyncRecord {
  id: string;
  customerId: string;
  customer?: {
    id: string;
    displayName: string;
    fullName: string;
    companyName?: string | null;
    email: string;
    phone?: string | null;
    state: string;
  } | null;
  provider: string;
  state: 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'SKIPPED';
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage?: string | null;
  externalReference?: string | null;
  createdAt?: string;
  syncedAt?: string | null;
}

export async function listCustomerSyncs(
  params?: {
    state?: string;
    limit?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: CustomerSyncRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/accounting/customers${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
    },
    options,
  );
}

export function customerSyncDisplayName(record: CustomerSyncRecord): string {
  return (
    record.customer?.displayName?.trim() ||
    record.customer?.companyName?.trim() ||
    record.customer?.fullName ||
    record.customer?.email ||
    'Unresolved customer'
  );
}

export interface PaymentSyncRecord {
  id: string;
  invoiceSyncId?: string | null;
  workOrderId: string;
  workOrder?: {
    id: string;
    workOrderNumber: string;
    state: string;
    scheduledStartAt?: string | null;
  } | null;
  customerId: string;
  customer?: {
    id: string;
    displayName: string;
    fullName: string;
    companyName?: string | null;
    email: string;
    phone?: string | null;
    state: string;
  } | null;
  qbPaymentId?: string | null;
  qbInvoiceId?: string | null;
  amountCents: number;
  paymentMethod?: string | null;
  paymentDate?: string | null;
  state: 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'RECONCILED' | 'MISMATCH';
  direction: 'INBOUND' | 'OUTBOUND';
  errorMessage?: string | null;
  attemptCount: number;
  lastAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listPaymentSyncRecords(
  params?: {
    state?: string;
    workOrderId?: string;
    customerId?: string;
    limit?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: PaymentSyncRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiFetch(
    `/accounting/payment-syncs${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
    },
    options,
  );
}

export async function retryPaymentSync(id: string): Promise<{ id: string; state: string }> {
  return apiFetch(`/accounting/payment-syncs/${id}/retry`, { method: 'POST' });
}

export function paymentSyncWorkOrderDisplayName(record: PaymentSyncRecord): string {
  return record.workOrder?.workOrderNumber || 'Unresolved work order';
}

export function paymentSyncCustomerDisplayName(record: PaymentSyncRecord): string {
  return (
    record.customer?.displayName?.trim() ||
    record.customer?.companyName?.trim() ||
    record.customer?.fullName ||
    record.customer?.email ||
    'Unresolved customer'
  );
}

export interface IntegrationAccount {
  id: string;
  provider?: string;
  accountKey?: string;
  displayName?: string;
  accountStatus?: string;
  configuration?: unknown;
  lastSyncedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  name?: string;
  accountType?: string;
  qbId?: string;
}

export async function listIntegrationAccounts(options?: ApiDataOptions): Promise<{
  items: IntegrationAccount[];
  total: number;
}> {
  return apiFetch('/accounting/integration-accounts', undefined, { items: [], total: 0 }, options);
}

export type DimensionMappingType = 'ITEM' | 'INCOME_ACCOUNT' | 'AR_ACCOUNT' | 'PAYMENT_METHOD';

export interface DimensionMapping {
  id: string;
  integrationAccountId: string;
  mappingType: DimensionMappingType;
  internalCode: string;
  externalId: string;
  displayName: string | null;
  namespace: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaxMapping {
  id: string;
  integrationAccountId: string;
  taxRegionCode: string;
  internalTaxCode: string;
  externalTaxCodeId: string;
  externalRateName: string | null;
  namespace: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDimensionMappingInput {
  integrationAccountId: string;
  mappingType: DimensionMappingType;
  internalCode: string;
  externalId: string;
  displayName?: string;
  namespace?: string;
}

export interface UpsertTaxMappingInput {
  integrationAccountId: string;
  taxRegionCode: string;
  internalTaxCode: string;
  externalTaxCodeId: string;
  externalRateName?: string;
  namespace?: string;
}

export async function listDimensionMappings(
  params: { integrationAccountId: string; namespace?: string },
  options?: ApiDataOptions,
): Promise<{ items: DimensionMapping[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('integrationAccountId', params.integrationAccountId);
  if (params.namespace) qs.set('namespace', params.namespace);
  return apiFetch(
    `/accounting/mappings/dimensions?${qs}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export async function upsertDimensionMapping(
  input: UpsertDimensionMappingInput,
): Promise<DimensionMapping> {
  return apiFetch('/accounting/mappings/dimensions', {
    method: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export async function listTaxMappings(
  params: { integrationAccountId: string; namespace?: string },
  options?: ApiDataOptions,
): Promise<{ items: TaxMapping[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('integrationAccountId', params.integrationAccountId);
  if (params.namespace) qs.set('namespace', params.namespace);
  return apiFetch(`/accounting/mappings/tax?${qs}`, undefined, { items: [], total: 0 }, options);
}

export async function upsertTaxMapping(input: UpsertTaxMappingInput): Promise<TaxMapping> {
  return apiFetch('/accounting/mappings/tax', {
    method: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify(input),
  });
}

export interface FailureSummary {
  invoice: number;
  customer: number;
  payment: number;
  total: number;
}

export async function getFailureSummary(options?: ApiDataOptions): Promise<FailureSummary> {
  return apiFetch(
    '/accounting/failures/summary',
    undefined,
    {
      invoice: 0,
      customer: 0,
      payment: 0,
      total: 0,
    },
    options,
  );
}

// ─── Dealers (legacy alias) ───────────────────────────────────────────────────

export interface Dealer {
  id: string;
  customerId?: string;
  name: string;
  primaryContact?: string;
  contactEmail?: string;
  phone?: string;
  serviceRelationship: 'ACTIVE' | 'INACTIVE';
  customerState?: Customer['state'];
  territory?: string;
  source?: string;
  updatedAt?: string;
}

export async function listDealers(
  params?: {
    search?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: Dealer[]; total: number; limit?: number; offset?: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const res = await apiFetch<{ items: Dealer[]; total: number } | Dealer[]>(
    `/identity/dealers${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
  return Array.isArray(res)
    ? { items: res, total: res.length }
    : { items: res.items ?? [], total: res.total ?? res.items?.length ?? 0 };
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

export async function listSops(params?: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: SopDocument[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sop${qs.size ? `?${qs}` : ''}`, undefined, { items: [], total: 0 });
}

export async function createSop(input: CreateSopInput): Promise<SopDocument> {
  const data = await apiFetch<{ sop: SopDocument }>('/sop', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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

export async function listTrainingModules(
  params?: {
    status?: string;
  },
  options?: ApiDataOptions,
): Promise<{ items: TrainingModule[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  return apiFetch(
    `/sop/modules${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export async function getTrainingModule(
  idOrCode: string,
  options?: ApiDataOptions,
): Promise<TrainingModule> {
  const data = await apiFetch<{ module: TrainingModule }>(
    `/sop/modules/${idOrCode}`,
    undefined,
    undefined,
    options,
  );
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
  quizAttempts: Array<{
    id: string;
    score: number;
    totalQuestions: number;
    passed: boolean;
    attemptedAt: string;
  }>;
}

export async function getModuleProgress(
  moduleIdOrCode: string,
  employeeId: string,
  options?: ApiDataOptions,
): Promise<ModuleProgressData> {
  return apiFetch(
    `/sop/modules/${moduleIdOrCode}/progress/${employeeId}`,
    undefined,
    {
      moduleId: moduleIdOrCode,
      employeeId,
      status: 'not-started',
      currentStep: null,
      startedAt: null,
      completedAt: null,
      steps: [],
      quizAttempts: [],
    },
    options,
  );
}

export async function updateStepProgress(
  moduleIdOrCode: string,
  params: {
    employeeId: string;
    stepId: string;
    status?: string;
    videoWatched?: boolean;
    videoProgress?: number;
    completed?: boolean;
  },
  options?: ApiDataOptions,
): Promise<void> {
  await apiFetch(
    `/sop/modules/${moduleIdOrCode}/step-progress`,
    {
      method: 'PUT',
      body: JSON.stringify(params),
    },
    undefined,
    options,
  );
}

export interface QuizSubmitResult {
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  passScore: number;
  answers: Array<{
    questionId: string;
    question: string;
    selectedAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
    explanation?: string;
  }>;
}

export async function submitQuiz(
  moduleIdOrCode: string,
  employeeId: string,
  answers: number[],
  options?: ApiDataOptions,
): Promise<QuizSubmitResult> {
  return apiFetch<QuizSubmitResult>(
    `/sop/modules/${moduleIdOrCode}/quiz`,
    {
      method: 'POST',
      body: JSON.stringify({ employeeId, answers }),
    },
    undefined,
    options,
  );
}

export interface OjtNote {
  id: string;
  moduleId: string;
  stepId?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export async function listNotes(
  employeeId: string,
  moduleId?: string,
  options?: ApiDataOptions,
): Promise<OjtNote[]> {
  const qs = new URLSearchParams({ employeeId });
  if (moduleId) qs.set('moduleId', moduleId);
  const data = await apiFetch<{ items: OjtNote[] }>(
    `/sop/notes?${qs}`,
    undefined,
    { items: [] },
    options,
  );
  return data.items;
}

export async function saveNote(
  employeeId: string,
  moduleId: string,
  content: string,
  stepId?: string,
  options?: ApiDataOptions,
): Promise<void> {
  await apiFetch(
    '/sop/notes',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId, moduleId, stepId, content }),
    },
    undefined,
    options,
  );
}

export async function listBookmarks(
  employeeId: string,
  moduleId?: string,
  options?: ApiDataOptions,
): Promise<Array<{ id: string; moduleId: string; stepId: string; createdAt: string }>> {
  const qs = new URLSearchParams({ employeeId });
  if (moduleId) qs.set('moduleId', moduleId);
  const data = await apiFetch<{
    items: Array<{ id: string; moduleId: string; stepId: string; createdAt: string }>;
  }>(`/sop/bookmarks?${qs}`, undefined, { items: [] }, options);
  return data.items;
}

export async function toggleBookmark(
  employeeId: string,
  moduleId: string,
  stepId: string,
  options?: ApiDataOptions,
): Promise<boolean> {
  const data = await apiFetch<{ bookmarked: boolean }>(
    '/sop/bookmarks',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId, moduleId, stepId }),
    },
    undefined,
    options,
  );
  return data.bookmarked;
}

// ─── Training Assignments ─────────────────────────────────────────────────────

export interface TrainingAssignment {
  id: string;
  moduleId: string;
  employeeId: string;
  assignmentStatus:
    | 'ASSIGNED'
    | 'IN_PROGRESS'
    | 'PENDING_SIGNOFF'
    | 'COMPLETED'
    | 'FAILED'
    | 'EXEMPT'
    | 'CANCELLED';
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  supervisorEmployeeId?: string;
  supervisorSignoffAt?: string;
  supervisorSignoffNote?: string;
  score?: number;
  module?: {
    moduleCode: string;
    moduleName: string;
    passScore?: number;
    validityDays?: number;
    isRequired: boolean;
    requiresSupervisorSignoff: boolean;
    sopDocument?: { documentCode: string; title: string };
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export async function listMyAssignments(
  employeeId?: string,
  params?: { status?: string },
  options?: ApiDataOptions,
): Promise<{ items: TrainingAssignment[]; total: number }> {
  const qs = new URLSearchParams();
  if (employeeId) qs.set('employeeId', employeeId);
  if (params?.status) qs.set('status', params.status);
  return apiFetch(
    `/ojt/assignments${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export interface CreateTrainingAssignmentsInput {
  moduleId: string;
  employeeId?: string;
  employeeIds?: string[];
  dueAt?: string;
}

export interface CreateTrainingAssignmentsResult {
  items: TrainingAssignment[];
  skipped: TrainingAssignment[];
  totalCreated: number;
  totalSkipped: number;
}

export async function createTrainingAssignments(
  input: CreateTrainingAssignmentsInput,
  options?: ApiDataOptions,
): Promise<CreateTrainingAssignmentsResult> {
  return apiFetch<CreateTrainingAssignmentsResult>(
    '/ojt/assignments',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    undefined,
    options,
  );
}

export async function completeAssignment(
  id: string,
  score?: number,
  options?: ApiDataOptions,
): Promise<TrainingAssignment> {
  const data = await apiFetch<{ assignment: TrainingAssignment }>(
    `/ojt/assignments/${id}/complete`,
    { method: 'PATCH', body: JSON.stringify({ score }) },
    undefined,
    options,
  );
  return data.assignment;
}

export async function signOffAssignment(
  id: string,
  input?: { supervisorEmployeeId?: string; signoffNote?: string },
  options?: ApiDataOptions,
): Promise<TrainingAssignment> {
  const data = await apiFetch<{ assignment: TrainingAssignment }>(
    `/ojt/assignments/${id}/complete`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: 'SIGN_OFF', ...input }),
    },
    undefined,
    options,
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

export async function listInspectionTemplates(): Promise<{
  items: InspectionTemplate[];
  total: number;
}> {
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
  author?: ChannelMessageAuthor;
  content: string;
  parentId: string | null;
  replyCount?: number;
  attachments: ChannelMessageAttachment[];
  reactions: { emoji: string; count: number; userIds: string[] }[];
  editedAt?: string;
  createdAt: string;
}

export interface ChannelMessageAuthor {
  id: string;
  displayName: string;
  email?: string;
  employeeNumber?: string;
}

export interface ChannelMessageAttachment {
  id: string;
  fileAttachmentId: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
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

export async function listMessages(
  channelId: string,
  params?: { limit?: number; before?: string },
): Promise<{ items: ChannelMessage[]; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.before) qs.set('before', params.before);
  return apiFetch(
    `/communication/channels/${channelId}/messages${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], hasMore: false },
  );
}

export async function listReplies(messageId: string): Promise<{ items: ChannelMessage[] }> {
  return apiFetch(`/communication/messages/${messageId}/replies`, undefined, { items: [] });
}

export async function sendMessage(
  channelId: string,
  input: { content: string; parentId?: string; attachmentIds?: string[] },
): Promise<ChannelMessage> {
  return apiFetch(`/communication/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function editMessage(
  messageId: string,
  content: string,
): Promise<{ id: string; content: string; editedAt: string }> {
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

export async function listChannelTodos(
  channelId: string,
  params?: { status?: string },
): Promise<{ items: ChannelTodo[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  return apiFetch(
    `/communication/channels/${channelId}/todos${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [] },
  );
}

export async function createChannelTodo(
  channelId: string,
  input: { title: string; assigneeId?: string; dueDate?: string },
): Promise<ChannelTodo> {
  return apiFetch(`/communication/channels/${channelId}/todos`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateChannelTodo(
  todoId: string,
  input: {
    title?: string;
    status?: 'OPEN' | 'DONE';
    assigneeId?: string | null;
    dueDate?: string | null;
  },
): Promise<ChannelTodo> {
  return apiFetch(`/communication/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listNotifications(params?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.unreadOnly) qs.set('unreadOnly', 'true');
  return apiFetch(`/communication/notifications${qs.size ? `?${qs}` : ''}`, undefined, {
    items: [],
    unreadCount: 0,
  });
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

export async function listAuditEvents(
  params?: {
    search?: string;
    action?: string;
    entityType?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: AuditEventRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.action) qs.set('action', params.action);
  if (params?.entityType) qs.set('entityType', params.entityType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/audit/events${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
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
  return apiFetch(`/scheduling/slots${qs.size ? `?${qs}` : ''}`, undefined, {
    items: [],
    total: 0,
  });
}

export type BuildSlotMaterialReadiness = 'READY' | 'PARTIAL' | 'NOT_READY';

export type BuildSlotDemandReason =
  | 'PROJECTED_TO_SLOT'
  | 'NO_CAPACITY'
  | 'OVER_CAPACITY'
  | 'MATERIAL_NOT_READY'
  | 'OPERATION_BLOCKED'
  | 'MISSING_ESTIMATE';

export interface BuildSlotDemandItem {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  status: string;
  priority: number;
  dueAt?: string;
  materialReadiness: BuildSlotMaterialReadiness;
  operationId: string;
  operationCode: string;
  operationName: string;
  sequenceNo: number;
  operationStatus: string;
  requiredSkillCode?: string;
  estimatedMinutes: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  updatedAt?: string;
  reason: BuildSlotDemandReason;
}

export interface BuildSlotProjectionWarning {
  code: 'OVER_CAPACITY' | 'MISSING_ESTIMATE' | 'NO_SLOT' | 'UNSCHEDULED' | 'BLOCKED';
  message: string;
}

export interface BuildSlotProjectionFreshness {
  state: 'LIVE' | 'NO_SOURCE';
  generatedAt: string;
  latestCapacityUpdatedAt?: string;
  latestDemandUpdatedAt?: string;
  latestSourceUpdatedAt?: string;
  sourceLagSeconds: number;
  staleAfterSeconds: number;
}

export type BuildSlotProjectionConflictCode =
  | 'NO_CAPACITY'
  | 'OVER_CAPACITY'
  | 'MATERIAL_NOT_READY'
  | 'OPERATION_BLOCKED'
  | 'MISSING_ESTIMATE';

export interface BuildSlotProjectionConflict {
  code: BuildSlotProjectionConflictCode;
  severity: 'high' | 'medium' | 'low';
  message: string;
  workOrderId?: string;
  workOrderNumber?: string;
  operationId?: string;
  capacitySlotId?: string;
  reason?: BuildSlotDemandReason;
}

export interface BuildSlotProjectionSlot {
  slotId: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  status: string;
  capacityMinutes: number;
  allocatedMinutes: number;
  projectedDemandMinutes: number;
  remainingMinutes: number;
  overCapacityMinutes: number;
  utilizationPct: number;
  updatedAt?: string;
  demand: BuildSlotDemandItem[];
  warnings: BuildSlotProjectionWarning[];
}

export interface BuildSlotDemandProjection {
  startDate: string;
  endDate: string;
  generatedAt: string;
  source: {
    workOrderStatuses: string[];
    operationStatuses: string[];
    capacitySource: 'planning.capacity_slots' | 'none';
  };
  freshness: BuildSlotProjectionFreshness;
  conflicts: BuildSlotProjectionConflict[];
  totals: {
    demandMinutes: number;
    capacityMinutes: number;
    allocatedMinutes: number;
    projectedDemandMinutes: number;
    remainingMinutes: number;
    unscheduledDemandMinutes: number;
    overCapacityMinutes: number;
    demandCount: number;
    scheduledCount: number;
    unscheduledCount: number;
    blockedByMaterialCount: number;
    blockedOperationCount: number;
    missingEstimateCount: number;
  };
  slots: BuildSlotProjectionSlot[];
  unscheduled: BuildSlotDemandItem[];
  warnings: BuildSlotProjectionWarning[];
}

export async function getBuildSlotDemandProjection(
  params?: {
    startDate?: string;
    endDate?: string;
  },
  options?: ApiDataOptions,
): Promise<BuildSlotDemandProjection> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  return apiFetch<BuildSlotDemandProjection>(
    `/scheduling/demand-projection${qs.size ? `?${qs}` : ''}`,
    undefined,
    undefined,
    options,
  );
}

export interface SchedulePreviewTotals {
  assignmentCount: number;
  scheduledMinutes: number;
  unscheduledCount: number;
  unscheduledMinutes: number;
  overCapacityMinutes: number;
}

export interface SchedulePreviewAssignment {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  status: string;
  priority: number;
  dueAt?: string;
  materialReadiness: string;
  operationId: string;
  operationCode: string;
  operationName: string;
  operationSequenceNo: number;
  operationStatus: string;
  requiredSkillCode?: string;
  estimatedMinutes: number;
  capacitySlotId: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  plannedStartAt: string;
  plannedEndAt: string;
  slotSequenceNo: number;
  reason: 'PROJECTED_TO_SLOT';
}

export interface SchedulePreviewResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  projection: BuildSlotDemandProjection;
  assignments: SchedulePreviewAssignment[];
  totals: SchedulePreviewTotals;
  warnings: BuildSlotProjectionWarning[];
}

export type ScheduleAssignmentState =
  | 'PROPOSED'
  | 'PUBLISHED'
  | 'DISPATCHED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface ScheduleAssignment {
  id: string;
  plannerRunId: string;
  assignmentState: ScheduleAssignmentState;
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  workOrderStatus: string;
  operationId: string;
  operationCode: string;
  operationName: string;
  operationSequenceNo: number;
  operationStatus: string;
  estimatedMinutes: number;
  capacitySlotId: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId: string;
  stockLocationCode: string;
  stockLocationName: string;
  bayCode?: string;
  teamCode?: string;
  plannedStartAt: string;
  plannedEndAt: string;
  slotSequenceNo: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleAssignmentListResponse {
  items: ScheduleAssignment[];
  total: number;
  limit: number;
  offset: number;
}

export interface SchedulePublicationResponse {
  run: {
    id: string;
    runStatus: string;
    algorithmVersion: string;
    inputHash: string;
    startedAt: string;
    completedAt: string;
    createdAt: string;
  };
  publishedAt: string;
  assignmentCount: number;
  scheduledMinutes: number;
  projection: BuildSlotDemandProjection;
  assignments: ScheduleAssignment[];
  totals: SchedulePreviewTotals;
  warnings: BuildSlotProjectionWarning[];
}

export async function getSchedulePreview(
  params?: {
    startDate?: string;
    endDate?: string;
  },
  options?: ApiDataOptions,
): Promise<SchedulePreviewResponse> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  return apiFetch<SchedulePreviewResponse>(
    `/scheduling/schedule-preview${qs.size ? `?${qs}` : ''}`,
    undefined,
    undefined,
    options,
  );
}

export async function listScheduleAssignments(
  params?: {
    startDate?: string;
    endDate?: string;
    state?: ScheduleAssignmentState;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<ScheduleAssignmentListResponse> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.state) qs.set('state', params.state);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch<ScheduleAssignmentListResponse>(
    `/scheduling/schedule-assignments${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0, limit: params?.limit ?? 100, offset: params?.offset ?? 0 },
    options,
  );
}

export async function publishSchedule(
  input: { startDate: string; endDate: string; notes?: string },
  options?: ApiDataOptions,
): Promise<SchedulePublicationResponse> {
  return apiFetch<SchedulePublicationResponse>(
    '/scheduling/schedule-publications',
    {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(),
    },
    undefined,
    options,
  );
}

export type CapacitySlotStatus = 'OPEN' | 'LOCKED' | 'EXECUTING' | 'CLOSED' | 'CANCELLED';

export interface CapacityStockLocationOption {
  id: string;
  locationCode: string;
  locationName: string;
  locationType: string;
}

export interface CapacitySlot {
  id: string;
  slotStart: string;
  slotEnd: string;
  date: string;
  stockLocationId: string;
  stockLocationCode: string;
  stockLocationName: string;
  stockLocationType: string;
  bayCode?: string;
  teamCode?: string;
  slotStatus: CapacitySlotStatus;
  capacityMinutes: number;
  allocatedMinutes: number;
  remainingMinutes: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CapacitySlotListResponse {
  items: CapacitySlot[];
  total: number;
  limit: number;
  offset: number;
  stockLocations: CapacityStockLocationOption[];
}

export interface CapacitySlotMutationInput {
  slotStart: string;
  slotEnd: string;
  stockLocationId: string;
  bayCode?: string;
  teamCode?: string;
  slotStatus?: CapacitySlotStatus;
  capacityMinutes: number;
}

export interface CapacitySlotImportRow {
  rowNumber?: number;
  slotStart?: string;
  slotEnd?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  stockLocationId?: string;
  locationCode?: string;
  bayCode?: string;
  teamCode?: string;
  capacityMinutes?: number;
  capacityHours?: number;
  slotStatus?: CapacitySlotStatus;
}

export interface CapacitySlotImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ rowNumber: number; message: string }>;
  items: CapacitySlot[];
  projection: BuildSlotDemandProjection;
}

export async function listCapacitySlots(
  params?: {
    startDate?: string;
    endDate?: string;
    status?: CapacitySlotStatus;
    stockLocationId?: string;
    bayCode?: string;
    teamCode?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<CapacitySlotListResponse> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.status) qs.set('status', params.status);
  if (params?.stockLocationId) qs.set('stockLocationId', params.stockLocationId);
  if (params?.bayCode) qs.set('bayCode', params.bayCode);
  if (params?.teamCode) qs.set('teamCode', params.teamCode);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch<CapacitySlotListResponse>(
    `/scheduling/capacity-slots${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0,
      stockLocations: [],
    },
    options,
  );
}

export async function createCapacitySlot(
  input: CapacitySlotMutationInput,
  options?: ApiDataOptions,
): Promise<CapacitySlot> {
  const data = await apiFetch<{ item: CapacitySlot }>(
    '/scheduling/capacity-slots',
    {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(),
    },
    undefined,
    options,
  );
  return data.item;
}

export async function updateCapacitySlot(
  id: string,
  input: Partial<CapacitySlotMutationInput> & { expectedVersion: number },
  options?: ApiDataOptions,
): Promise<CapacitySlot> {
  const data = await apiFetch<{ item: CapacitySlot }>(
    `/scheduling/capacity-slots/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: mutationHeaders(),
    },
    undefined,
    options,
  );
  return data.item;
}

export async function cancelCapacitySlot(
  id: string,
  input: { expectedVersion: number },
  options?: ApiDataOptions,
): Promise<CapacitySlot> {
  const data = await apiFetch<{ item: CapacitySlot }>(
    `/scheduling/capacity-slots/${id}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(),
    },
    undefined,
    options,
  );
  return data.item;
}

export async function importCapacitySlots(
  input: { startDate: string; endDate: string; rows: CapacitySlotImportRow[] },
  options?: ApiDataOptions,
): Promise<CapacitySlotImportResult> {
  return apiFetch<CapacitySlotImportResult>(
    '/scheduling/capacity-slots/import',
    {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(),
    },
    undefined,
    options,
  );
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SalesCustomerProfile {
  id: string;
  displayName: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  state: string;
}

export interface SalesUserProfile {
  id: string;
  displayName: string;
  email: string;
  employeeName?: string;
  employeeNumber?: string;
}

export interface SalesOpportunity {
  id: string;
  customerId: string;
  customerProfile?: SalesCustomerProfile;
  title: string;
  description: string | null;
  stage: string;
  probability: number;
  estimatedValue: number | null;
  expectedCloseDate: string | null;
  assignedToUserId: string | null;
  assignedToUser?: SalesUserProfile;
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
  customerProfile?: SalesCustomerProfile;
  status: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  createdByUserId: string | null;
  createdByUser?: SalesUserProfile;
  convertedWoId?: string | null;
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

type CustomerDisplayRecord = {
  displayName?: string;
  companyName?: string;
  fullName?: string;
  email?: string;
};

export function salesCustomerDisplayName(customer?: CustomerDisplayRecord | null): string {
  return (
    customer?.displayName?.trim() ||
    customer?.companyName ||
    customer?.fullName ||
    customer?.email ||
    'Unresolved customer'
  );
}

export function salesUserDisplayName(user?: SalesUserProfile | null): string {
  return user?.displayName?.trim() || user?.employeeName || user?.email || 'Unresolved user';
}

export async function listOpportunities(
  params?: {
    stage?: string;
    customerId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: SalesOpportunity[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.stage) qs.set('stage', params.stage);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/sales/opportunities${qs.size ? `?${qs}` : ''}`,
    undefined,
    {
      items: [],
      total: 0,
    },
    options,
  );
}

export async function getOpportunity(
  id: string,
  options?: ApiDataOptions,
): Promise<SalesOpportunity & { quotes: Quote[]; activities: SalesActivity[] }> {
  const data = await apiFetch<{
    opportunity: SalesOpportunity & { quotes: Quote[]; activities: SalesActivity[] };
  }>(`/sales/opportunities/${id}`, undefined, undefined, options);
  return data.opportunity;
}

export async function createOpportunity(input: {
  customerId: string;
  title: string;
  description?: string;
  stage?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  source?: string;
}): Promise<SalesOpportunity> {
  const data = await apiFetch<{ opportunity: SalesOpportunity }>('/sales/opportunities', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.opportunity;
}

export async function transitionOpportunityStage(
  id: string,
  stage: string,
  lostReason?: string,
): Promise<SalesOpportunity> {
  const data = await apiFetch<{ opportunity: SalesOpportunity }>(
    `/sales/opportunities/${id}/stage`,
    {
      method: 'POST',
      body: JSON.stringify({ stage, lostReason }),
    },
  );
  return data.opportunity;
}

export async function listQuotes(
  params?: {
    status?: string;
    customerId?: string;
    opportunityId?: string;
    limit?: number;
    offset?: number;
  },
  options?: ApiDataOptions,
): Promise<{ items: Quote[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.opportunityId) qs.set('opportunityId', params.opportunityId);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(
    `/sales/quotes${qs.size ? `?${qs}` : ''}`,
    undefined,
    { items: [], total: 0 },
    options,
  );
}

export async function getQuote(id: string, options?: ApiDataOptions): Promise<Quote> {
  const data = await apiFetch<{ quote: Quote }>(
    `/sales/quotes/${id}`,
    undefined,
    undefined,
    options,
  );
  return data.quote;
}

export async function createQuote(input: {
  customerId: string;
  opportunityId?: string;
  notes?: string;
  validUntil?: string;
  lines?: Array<{
    partId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
  }>;
}): Promise<Quote> {
  const data = await apiFetch<{ quote: Quote }>('/sales/quotes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.quote;
}

export async function sendQuote(id: string): Promise<Quote> {
  const data = await apiFetch<{ quote: Quote }>(`/sales/quotes/${id}/send`, { method: 'POST' });
  return data.quote;
}

export async function acceptQuote(id: string): Promise<Quote> {
  const data = await apiFetch<{ quote: Quote }>(`/sales/quotes/${id}/accept`, { method: 'POST' });
  return data.quote;
}

export async function convertQuoteToWorkOrder(id: string): Promise<{
  quote: Quote;
  workOrder: { id: string; workOrderNumber: string; title: string; status: string };
  operationsCreated?: number;
  partLinesCreated?: number;
  alreadyConverted?: boolean;
}> {
  return apiFetch(`/sales/quotes/${id}/convert-to-work-order`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function rejectQuote(id: string, reason?: string): Promise<Quote> {
  const data = await apiFetch<{ quote: Quote }>(`/sales/quotes/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return data.quote;
}

export async function listActivities(params?: {
  opportunityId?: string;
  customerId?: string;
  activityType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: SalesActivity[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.opportunityId) qs.set('opportunityId', params.opportunityId);
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.activityType) qs.set('activityType', params.activityType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/sales/activities${qs.size ? `?${qs}` : ''}`, undefined, {
    items: [],
    total: 0,
  });
}

export async function createActivity(input: {
  opportunityId?: string;
  customerId?: string;
  activityType: string;
  subject: string;
  body?: string;
  dueDate?: string;
}): Promise<SalesActivity> {
  return apiFetch('/sales/activities', { method: 'POST', body: JSON.stringify(input) });
}

export async function getSalesPipelineStats(): Promise<PipelineStats> {
  return apiFetch('/sales/pipeline-stats', undefined, {
    totalOpportunities: 0,
    totalValue: 0,
    weightedForecast: 0,
    avgDealSize: 0,
    winRate: 0,
    byStage: [],
  });
}

export async function getSalesForecast(): Promise<SalesForecastMonth[]> {
  const data = await apiFetch<SalesForecastMonth[] | { forecast?: SalesForecastMonth[] }>(
    '/sales/forecast',
    undefined,
    [],
  );
  return Array.isArray(data) ? data : (data.forecast ?? []);
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export interface UploadedAttachment {
  attachmentId: string;
  fileName: string;
}

export async function uploadAttachment(input: {
  entityType: string;
  entityId: string;
  file: File;
}): Promise<UploadedAttachment> {
  const presign = await apiFetch<{ attachmentId: string; uploadUrl: string }>(
    '/attachments/presign',
    {
      method: 'POST',
      body: JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        sizeBytes: input.file.size,
      }),
    },
  );

  const upload = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': input.file.type || 'application/octet-stream' },
    body: input.file,
  });
  if (!upload.ok) {
    throw new Error(`Attachment upload failed (${upload.status})`);
  }

  await apiFetch(`/attachments/${presign.attachmentId}/confirm`, { method: 'PUT' });
  return { attachmentId: presign.attachmentId, fileName: input.file.name };
}

export async function getAttachmentDownloadUrl(id: string): Promise<{
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  expiresIn: number;
}> {
  return apiFetch(`/attachments/${id}/download`);
}

export async function getSalesDashboard(): Promise<SalesDashboard> {
  return apiFetch('/sales/dashboard', undefined, {
    pipelineStats: {
      totalOpportunities: 0,
      totalValue: 0,
      weightedForecast: 0,
      avgDealSize: 0,
      winRate: 0,
      byStage: [],
    },
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
  return apiFetch(`/sales/agent/sessions${qs.size ? `?${qs}` : ''}`, undefined, {
    items: [],
    total: 0,
  });
}

export async function getAgentSession(
  id: string,
): Promise<AgentChatSession & { messages: AgentChatMessage[] }> {
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
  id: string,
): Promise<{ id: string; messages: AgentChatMessage[] }> {
  return apiFetch(`/copilot/sessions/${id}`);
}
