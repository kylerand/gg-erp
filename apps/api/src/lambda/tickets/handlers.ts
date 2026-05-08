import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import { QcGateService } from '../../contexts/tickets/qcGate.service.js';
import { TimeEntryService } from '../../contexts/tickets/timeEntry.service.js';
import type { CreateLaborTimeEntryInput } from '../../../../../packages/domain/src/model/tickets.js';

let prisma: PrismaClient | undefined;
let prismaOverride: Partial<PrismaClient> | undefined;
let qcGateService: QcGateService | undefined;
let timeEntryService: TimeEntryService | undefined;
let timeEntryServiceOverride:
  | Pick<TimeEntryService, 'listEntries' | 'createEntry' | 'updateEntry' | 'deleteEntry'>
  | undefined;

function getPrisma(): PrismaClient {
  if (prismaOverride) return prismaOverride as PrismaClient;
  prisma ??= new PrismaClient();
  return prisma;
}

function getQcGateService(): QcGateService {
  qcGateService ??= new QcGateService(getPrisma());
  return qcGateService;
}

function getTimeEntryService(): TimeEntryService {
  if (timeEntryServiceOverride) {
    return timeEntryServiceOverride as TimeEntryService;
  }

  timeEntryService ??= new TimeEntryService(getPrisma());
  return timeEntryService;
}

export function setTicketHandlerTimeEntryServiceForTests(
  service:
    | Pick<TimeEntryService, 'listEntries' | 'createEntry' | 'updateEntry' | 'deleteEntry'>
    | undefined,
): void {
  timeEntryServiceOverride = service;
}

export function setTicketHandlerPrismaForTests(client: Partial<PrismaClient> | undefined): void {
  prismaOverride = client;
}

export async function disconnectTicketHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
  prismaOverride = undefined;
  qcGateService = undefined;
  timeEntryService = undefined;
  timeEntryServiceOverride = undefined;
}

// ─── Technician Tasks ─────────────────────────────────────────────────────────

// Prisma's UUID columns reject any non-UUID string with a 500 at the driver
// layer. The frontend occasionally passes demo placeholder IDs (e.g. "emp-1")
// before Cognito has supplied a real user ID. Treat such filters as "no matches"
// rather than crashing the endpoint.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value: string | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

export const listTasksHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const rawWorkOrderId = qs.workOrderId;
    const rawTechnicianId = qs.technicianId;
    const state = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const workOrderId = uuidOrNull(rawWorkOrderId);
    const technicianId = uuidOrNull(rawTechnicianId);

    // If the caller filtered by a non-UUID id, the result set is empty by
    // definition (no row can match). Short-circuit instead of round-tripping.
    if ((rawWorkOrderId && !workOrderId) || (rawTechnicianId && !technicianId)) {
      return jsonResponse(200, { items: [] });
    }

    const where = {
      ...(workOrderId ? { workOrderId } : {}),
      ...(technicianId ? { technicianId } : {}),
      ...(state
        ? { state: state as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' }
        : {}),
    };

    const items = await getPrisma().technicianTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: items.map(toTaskResponse) });
  },
  { requireAuth: false },
);

export const createTaskHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{ workOrderId: string; routingStepId: string; technicianId?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { workOrderId, routingStepId, technicianId } = body.value;
    if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!routingStepId) return jsonResponse(422, { message: 'routingStepId is required.' });

    const task = await getPrisma().technicianTask.create({
      data: {
        id: randomUUID(),
        workOrderId,
        routingStepId,
        technicianId: technicianId ?? null,
        state: 'READY',
        correlationId: ctx.correlationId,
        updatedAt: new Date(),
      },
    });

    return jsonResponse(201, { task: toTaskResponse(task) });
  },
  { requireAuth: false },
);

const TASK_TRANSITIONS: Record<string, string[]> = {
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export const transitionTaskHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Task ID is required.' });

    const body = parseBody<{ state: string; blockedReason?: string; technicianId?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { state: nextState, blockedReason, technicianId } = body.value;
    if (!nextState) return jsonResponse(422, { message: 'state is required.' });

    const existing = await getPrisma().technicianTask.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Task not found: ${id}` });

    if (nextState === existing.state && technicianId) {
      const task = await getPrisma().technicianTask.update({
        where: { id },
        data: {
          technicianId,
          updatedAt: new Date(),
        },
      });
      return jsonResponse(200, { task: toTaskResponse(task) });
    }

    const allowed = TASK_TRANSITIONS[existing.state as string] ?? [];
    if (!allowed.includes(nextState)) {
      return jsonResponse(409, {
        message: `Cannot transition task from ${existing.state} to ${nextState}.`,
        allowedTransitions: allowed,
      });
    }

    const now = new Date();
    const task = await getPrisma().technicianTask.update({
      where: { id },
      data: {
        state: nextState as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED',
        updatedAt: now,
        ...(nextState === 'IN_PROGRESS' && !existing.startedAt ? { startedAt: now } : {}),
        ...(nextState === 'DONE' ? { completedAt: now } : {}),
        ...(nextState === 'BLOCKED' && blockedReason ? { blockedReason } : {}),
        ...(technicianId ? { technicianId } : {}),
      },
    });

    return jsonResponse(200, { task: toTaskResponse(task) });
  },
  { requireAuth: false },
);

// ─── Rework Issues ────────────────────────────────────────────────────────────

export const listReworkHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = qs.workOrderId;
    const state = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const where = {
      ...(workOrderId ? { workOrderId } : {}),
      ...(state
        ? { state: state as 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REOPENED' | 'CLOSED' }
        : {}),
    };

    const items = await getPrisma().reworkIssue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: items.map(toReworkResponse) });
  },
  { requireAuth: false },
);

export const createReworkHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{
      workOrderId: string;
      title: string;
      description: string;
      severity: string;
      reportedBy: string;
      assignedTo?: string;
    }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { workOrderId, title, description, severity, reportedBy, assignedTo } = body.value;
    if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });
    if (!description?.trim()) return jsonResponse(422, { message: 'description is required.' });
    if (!severity) return jsonResponse(422, { message: 'severity is required.' });
    if (!reportedBy) return jsonResponse(422, { message: 'reportedBy is required.' });

    const issue = await getPrisma().reworkIssue.create({
      data: {
        id: randomUUID(),
        workOrderId,
        title: title.trim(),
        description: description.trim(),
        severity: severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        state: 'OPEN',
        reportedBy,
        assignedTo: assignedTo ?? null,
        correlationId: ctx.correlationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return jsonResponse(201, { issue: toReworkResponse(issue) });
  },
  { requireAuth: false },
);

// ─── Invoice Sync ─────────────────────────────────────────────────────────────

export const listInvoiceSyncHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const state = qs.state as string | undefined;
    const workOrderId = qs.workOrderId;
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

    const where = {
      ...(state
        ? { state: state as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED' }
        : {}),
      ...(workOrderId ? { workOrderId } : {}),
    };

    const items = await getPrisma().invoiceSyncRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: items.map(toSyncResponse) });
  },
  { requireAuth: false },
);

// ─── QC Gates ─────────────────────────────────────────────────────────────────

export const getQcGatesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = ctx.event.pathParameters?.workOrderId ?? qs.workOrderId;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });

    const gates = await getQcGateService().getGates({ workOrderId, taskId: qs.taskId });
    return jsonResponse(200, { gates });
  },
  { requireAuth: false },
);

export const batchSubmitQcGatesHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{
      workOrderId: string;
      taskId?: string;
      reviewedBy: string;
      results: Array<{
        gateLabel: string;
        isCritical: boolean;
        result: 'PASS' | 'FAIL' | 'NA';
        failureNote?: string;
      }>;
    }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const workOrderId = ctx.event.pathParameters?.workOrderId ?? body.value.workOrderId;
    const { taskId, reviewedBy, results } = body.value;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });
    if (!reviewedBy) return jsonResponse(400, { message: 'reviewedBy is required.' });
    if (!results || results.length === 0)
      return jsonResponse(400, { message: 'results array must not be empty.' });

    const outcome = await getQcGateService().batchSubmit({
      workOrderId,
      taskId,
      reviewedBy,
      results,
      correlationId: ctx.correlationId,
    });

    return jsonResponse(200, {
      ...outcome,
      status: outcome.overallResult,
      openReworkCount: outcome.reworkIssuesCreated,
    });
  },
  { requireAuth: false },
);

// ─── Labor Time Entries ───────────────────────────────────────────────────────

export const listTimeEntriesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = ctx.event.pathParameters?.workOrderId ?? qs.workOrderId;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });

    const entries = await getTimeEntryService().listEntries({
      workOrderId,
      technicianId: qs.technicianId,
    });
    return jsonResponse(200, { entries });
  },
  { requireAuth: false },
);

export const createTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateLaborTimeEntryInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const input = body.value;
    if (!input.workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!input.technicianId) return jsonResponse(422, { message: 'technicianId is required.' });
    if (!input.startedAt) return jsonResponse(422, { message: 'startedAt is required.' });

    const entry = await getTimeEntryService().createEntry({
      ...input,
      correlationId: ctx.correlationId,
    });
    return jsonResponse(201, { entry });
  },
  { requireAuth: false },
);

export const updateTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

    const body = parseBody<{ endedAt?: string; manualHours?: number; description?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const entry = await getTimeEntryService().updateEntry(id, body.value, ctx.correlationId);
    return jsonResponse(200, { entry });
  },
  { requireAuth: false },
);

export const deleteTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

    await getTimeEntryService().deleteEntry(id);
    return jsonResponse(204, {});
  },
  { requireAuth: false },
);

// ─── Response mappers ─────────────────────────────────────────────────────────

function toTaskResponse(r: {
  id: string;
  workOrderId: string;
  routingStepId: string;
  technicianId: string | null;
  state: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  blockedReason?: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    routingStepId: r.routingStepId,
    technicianId: r.technicianId ?? undefined,
    state: r.state,
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    blockedReason: r.blockedReason ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toReworkResponse(r: {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  severity: string;
  state: string;
  reportedBy: string;
  assignedTo: string | null;
  createdAt: Date;
  resolvedAt?: Date | null;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    state: r.state,
    reportedBy: r.reportedBy,
    assignedTo: r.assignedTo ?? undefined,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString(),
  };
}

function toSyncResponse(r: {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: string;
  state: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  externalReference: string | null;
  createdAt: Date;
  syncedAt?: Date | null;
}) {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    workOrderId: r.workOrderId,
    provider: r.provider,
    state: r.state,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    createdAt: r.createdAt.toISOString(),
    syncedAt: r.syncedAt?.toISOString(),
  };
}

// ─── Work Order Queue (floor-tech) ───────────────────────────────────────────

type WoStatus =
  | 'DRAFT'
  | 'READY'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED';

const ACTIVE_WO_STATUSES: WoStatus[] = ['READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED'];

function mapWoStatus(status: string): 'READY' | 'IN_PROGRESS' | 'BLOCKED' {
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'BLOCKED') return 'BLOCKED';
  return 'READY';
}

function formatAge(date: Date | null): string {
  if (!date) return 'Unknown';
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `Started ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Started ${hours}h ago`;
  return `Started ${Math.floor(hours / 24)}d ago`;
}

interface WoOperation {
  id: string;
  operationCode?: string;
  sequenceNo?: number;
  operationName: string;
  operationStatus: string;
  requiredSkillCode?: string | null;
  estimatedMinutes?: number;
  blockingReason?: string | null;
}

interface WoPart {
  id: string;
  partId: string;
  partStatus: string;
  requestedQuantity?: unknown;
  reservedQuantity?: unknown;
  consumedQuantity?: unknown;
  part?: { name?: string; sku?: string } | null;
}

interface WoDetailOrder {
  id: string;
  workOrderNumber: string;
  title: string;
  customerReference?: string | null;
  assetReference?: string | null;
  stockLocation?: { locationName?: string | null } | null;
  status: string;
  dueAt?: Date | null;
  operations?: WoOperation[];
  parts?: WoPart[];
  statusHistory?: WoStatusHistoryRecord[];
}

interface WoStatusHistoryRecord {
  id: string;
  fromStatus?: string | null;
  toStatus: string;
  reasonCode?: string | null;
  reasonNote?: string | null;
  actorUserId?: string | null;
  correlationId: string;
  createdAt: Date;
}

interface WorkOrderCommercialContext {
  customerProfile?: {
    id: string;
    fullName: string;
    companyName?: string;
    email: string;
    phone?: string;
    state: string;
    preferredContactMethod: string;
    externalReference?: string;
  };
  cartProfile?: {
    id: string;
    vin: string;
    serialNumber: string;
    modelCode: string;
    modelYear: number;
    customerId: string;
    state: string;
  };
  quotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    total: number;
    validUntil?: string;
    convertedWoId?: string;
    updatedAt: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    stage: string;
    probability: number;
    estimatedValue?: number;
    expectedCloseDate?: string;
    wonWorkOrderId?: string;
    updatedAt: string;
  }>;
  activities: Array<{
    id: string;
    activityType: string;
    subject: string;
    body?: string;
    dueDate?: string;
    completedAt?: string;
    createdAt: string;
  }>;
}

const EMPTY_COMMERCIAL_CONTEXT: WorkOrderCommercialContext = {
  quotes: [],
  opportunities: [],
  activities: [],
};

interface WorkOrderReservationRow {
  id: string;
  status: string;
  reservedQuantity: unknown;
  consumedQuantity: unknown;
  allocatedQuantity: unknown;
  reservationPriority: number;
  shortageReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  partId: string;
  partSku: string;
  partName: string;
  unitOfMeasure: string;
  stockLocationId: string;
  locationName: string;
  stockLotId: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  workOrderId: string;
  workOrderNumber: string | null;
  workOrderTitle: string | null;
  workOrderPartId: string | null;
}

function numberFromDb(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return 0;
}

function workOrderPartOpenQuantity(part: WoPart): number {
  return Math.max(
    numberFromDb(part.requestedQuantity) -
      numberFromDb(part.reservedQuantity) -
      numberFromDb(part.consumedQuantity),
    0,
  );
}

function toWorkOrderReservationResponse(r: WorkOrderReservationRow) {
  const reservedQuantity = numberFromDb(r.reservedQuantity);
  const consumedQuantity = numberFromDb(r.consumedQuantity);
  const allocatedQuantity = numberFromDb(r.allocatedQuantity);
  const isOpen = r.status === 'ACTIVE' || r.status === 'PARTIALLY_CONSUMED';

  return {
    id: r.id,
    status: r.status,
    reservedQuantity,
    consumedQuantity,
    allocatedQuantity,
    openQuantity: isOpen ? Math.max(reservedQuantity - consumedQuantity - allocatedQuantity, 0) : 0,
    reservationPriority: r.reservationPriority,
    shortageReason: r.shortageReason ?? undefined,
    expiresAt: r.expiresAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    partId: r.partId,
    partSku: r.partSku,
    partName: r.partName,
    unitOfMeasure: r.unitOfMeasure,
    stockLocationId: r.stockLocationId,
    locationName: r.locationName,
    stockLotId: r.stockLotId ?? undefined,
    lotNumber: r.lotNumber ?? r.stockLotId ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    workOrderId: r.workOrderId,
    workOrderNumber: r.workOrderNumber ?? undefined,
    workOrderTitle: r.workOrderTitle ?? undefined,
    workOrderPartId: r.workOrderPartId ?? undefined,
  };
}

function optionalIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function isUuid(value?: string | null): value is string {
  return Boolean(value && UUID_RE.test(value));
}

function toCustomerProfileResponse(r: {
  id: string;
  fullName: string;
  companyName?: string | null;
  email: string;
  phone?: string | null;
  state: string;
  preferredContactMethod: string;
  externalReference?: string | null;
}) {
  return {
    id: r.id,
    fullName: r.fullName,
    companyName: r.companyName ?? undefined,
    email: r.email,
    phone: r.phone ?? undefined,
    state: r.state,
    preferredContactMethod: r.preferredContactMethod,
    externalReference: r.externalReference ?? undefined,
  };
}

function toCartProfileResponse(r: {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: string;
}) {
  return {
    id: r.id,
    vin: r.vin,
    serialNumber: r.serialNumber,
    modelCode: r.modelCode,
    modelYear: r.modelYear,
    customerId: r.customerId,
    state: r.state,
  };
}

function toQuoteSummaryResponse(r: {
  id: string;
  quoteNumber: string;
  status: string;
  total: unknown;
  validUntil?: Date | null;
  convertedWoId?: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    quoteNumber: r.quoteNumber,
    status: r.status,
    total: numberFromDb(r.total),
    validUntil: optionalIso(r.validUntil),
    convertedWoId: r.convertedWoId ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toOpportunitySummaryResponse(r: {
  id: string;
  title: string;
  stage: string;
  probability: number;
  estimatedValue?: unknown;
  expectedCloseDate?: Date | null;
  wonWorkOrderId?: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    stage: r.stage,
    probability: r.probability,
    estimatedValue: r.estimatedValue == null ? undefined : numberFromDb(r.estimatedValue),
    expectedCloseDate: optionalIso(r.expectedCloseDate),
    wonWorkOrderId: r.wonWorkOrderId ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toSalesActivitySummaryResponse(r: {
  id: string;
  activityType: string;
  subject: string;
  body?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    activityType: r.activityType,
    subject: r.subject,
    body: r.body ?? undefined,
    dueDate: optionalIso(r.dueDate),
    completedAt: optionalIso(r.completedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

function toStatusHistoryResponse(r: WoStatusHistoryRecord) {
  return {
    id: r.id,
    fromStatus: r.fromStatus ?? undefined,
    toStatus: r.toStatus,
    reasonCode: r.reasonCode ?? undefined,
    reasonNote: r.reasonNote ?? undefined,
    actorUserId: r.actorUserId ?? undefined,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
  };
}

async function resolveCustomerProfile(reference?: string | null) {
  if (!reference?.trim()) return undefined;
  const value = reference.trim();
  const customer = await getPrisma().customer.findFirst({
    where: {
      OR: [
        ...(isUuid(value) ? [{ id: value }] : []),
        { externalReference: value },
        { fullName: { contains: value, mode: 'insensitive' as const } },
        { companyName: { contains: value, mode: 'insensitive' as const } },
        { email: { contains: value, mode: 'insensitive' as const } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  return customer ? toCustomerProfileResponse(customer) : undefined;
}

async function resolveCartProfile(reference?: string | null, customerId?: string) {
  if (!reference?.trim() && !customerId) return undefined;
  const value = reference?.trim();
  const cart = await getPrisma().cartVehicle.findFirst({
    where: {
      ...(customerId ? { customerId } : {}),
      ...(value
        ? {
            OR: [
              ...(isUuid(value) ? [{ id: value }] : []),
              { vin: { contains: value, mode: 'insensitive' as const } },
              { serialNumber: { contains: value, mode: 'insensitive' as const } },
              { modelCode: { contains: value, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });

  return cart ? toCartProfileResponse(cart) : undefined;
}

async function buildCommercialContext(order: {
  id: string;
  customerReference?: string | null;
  assetReference?: string | null;
}): Promise<WorkOrderCommercialContext> {
  const customerProfile = await resolveCustomerProfile(order.customerReference);
  const cartProfile = await resolveCartProfile(order.assetReference, customerProfile?.id);
  const quoteWhere = customerProfile
    ? { OR: [{ customerId: customerProfile.id }, { convertedWoId: order.id }] }
    : { convertedWoId: order.id };
  const opportunityWhere = customerProfile
    ? { OR: [{ customerId: customerProfile.id }, { wonWorkOrderId: order.id }] }
    : { wonWorkOrderId: order.id };

  const [quotes, opportunities, activities] = await Promise.all([
    getPrisma().quote.findMany({
      where: quoteWhere,
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    getPrisma().salesOpportunity.findMany({
      where: opportunityWhere,
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    customerProfile
      ? getPrisma().salesActivity.findMany({
          where: { customerId: customerProfile.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  return {
    customerProfile,
    cartProfile,
    quotes: quotes.map(toQuoteSummaryResponse),
    opportunities: opportunities.map(toOpportunitySummaryResponse),
    activities: activities.map(toSalesActivitySummaryResponse),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQueueItem(order: any) {
  const ops: WoOperation[] = order.operations ?? [];
  const parts: WoPart[] = order.parts ?? [];
  const doneOps = ops.filter((op) =>
    ['DONE', 'SKIPPED', 'CANCELLED'].includes(op.operationStatus),
  ).length;
  const firstPending = ops.find(
    (op) => !['DONE', 'SKIPPED', 'CANCELLED'].includes(op.operationStatus),
  );
  const shortageCount = parts.filter((p) => p.partStatus === 'SHORT').length;
  const materialReadiness =
    parts.length === 0
      ? 'READY'
      : shortageCount > 0
        ? 'NOT_READY'
        : parts.some((p) => workOrderPartOpenQuantity(p) > 0)
          ? 'PARTIAL'
          : 'READY';
  return {
    id: order.id,
    number: order.workOrderNumber,
    title: order.title,
    customer: order.customerReference ?? 'Unknown customer',
    cart: order.assetReference ?? '—',
    bay: order.stockLocation?.locationName ?? '—',
    age: formatAge(order.openedAt),
    status: mapWoStatus(order.status),
    materialReadiness,
    shortageCount: shortageCount || undefined,
    reworkLoop: 0,
    syncStatus: 'SYNCED',
    checklistCompletion:
      ops.length > 0 ? `${doneOps} / ${ops.length} ops complete` : 'No operations',
    nextAction: firstPending?.operationName ?? 'All operations complete',
  };
}

function toDetailItem(
  order: WoDetailOrder,
  reservations: WorkOrderReservationRow[] = [],
  commercialContext: WorkOrderCommercialContext = EMPTY_COMMERCIAL_CONTEXT,
) {
  const ops: WoOperation[] = order.operations ?? [];
  const partLines: WoPart[] = order.parts ?? [];
  const reservationResponses = reservations.map(toWorkOrderReservationResponse);
  const reservationsByPartLine = new Map<string, typeof reservationResponses>();
  for (const reservation of reservationResponses) {
    if (!reservation.workOrderPartId) continue;
    const current = reservationsByPartLine.get(reservation.workOrderPartId) ?? [];
    current.push(reservation);
    reservationsByPartLine.set(reservation.workOrderPartId, current);
  }

  const shortageCount = partLines.filter((p) => p.partStatus === 'SHORT').length;
  const materialReadiness =
    partLines.length === 0
      ? 'READY'
      : shortageCount > 0
        ? 'NOT_READY'
        : partLines.some((p) => workOrderPartOpenQuantity(p) > 0)
          ? 'PARTIAL'
          : 'READY';
  return {
    id: order.id,
    number: order.workOrderNumber,
    title: order.title,
    customerReference: order.customerReference ?? undefined,
    assetReference: order.assetReference ?? undefined,
    customer: order.customerReference ?? 'Unknown customer',
    cart: order.assetReference ?? '—',
    customerProfile: commercialContext.customerProfile,
    cartProfile: commercialContext.cartProfile,
    commercialContext: {
      quotes: commercialContext.quotes,
      opportunities: commercialContext.opportunities,
      activities: commercialContext.activities,
    },
    bay: order.stockLocation?.locationName ?? '—',
    status: mapWoStatus(order.status),
    eta: order.dueAt ? new Date(order.dueAt).toLocaleDateString() : 'No due date',
    syncStatus: 'SYNCED',
    materialReadiness,
    shortageCount: shortageCount || undefined,
    reworkLoop: 0,
    checklist: ops.map((op) => ({
      id: op.id,
      label: op.operationName,
      done: ['DONE', 'SKIPPED'].includes(op.operationStatus),
      operationCode: op.operationCode,
      sequenceNo: op.sequenceNo,
      status: op.operationStatus,
      requiredSkillCode: op.requiredSkillCode ?? undefined,
      estimatedMinutes: op.estimatedMinutes,
      blockingReason: op.blockingReason ?? undefined,
    })),
    parts: partLines.map((p) => {
      const requestedQuantity = numberFromDb(p.requestedQuantity);
      const reservedQuantity = numberFromDb(p.reservedQuantity);
      const consumedQuantity = numberFromDb(p.consumedQuantity);
      return {
        id: p.id,
        partId: p.partId,
        partSku: p.part?.sku ?? p.partId,
        name: p.part?.name ?? p.partId,
        qty: requestedQuantity,
        requestedQuantity,
        reservedQuantity,
        consumedQuantity,
        openQuantity: Math.max(requestedQuantity - reservedQuantity - consumedQuantity, 0),
        state: p.partStatus,
        reservations: reservationsByPartLine.get(p.id) ?? [],
      };
    }),
    reservations: reservationResponses,
    notes: [] as { id: string; author: string; message: string; createdAt: string }[],
    statusHistory: ((order.statusHistory ?? []) as WoStatusHistoryRecord[]).map(
      toStatusHistoryResponse,
    ),
  };
}

export const listWoQueueHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = qs.status as WoStatus | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

    const orders = await getPrisma().woOrder.findMany({
      where: { status: status ? { equals: status } : { in: ACTIVE_WO_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        stockLocation: { select: { locationName: true } },
        operations: { orderBy: { sequenceNo: 'asc' } },
        parts: true,
      },
    });

    return jsonResponse(200, { items: orders.map(toQueueItem) });
  },
  { requireAuth: false },
);

export const getWoDetailHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Work order ID is required.' });

    const order = await getPrisma().woOrder.findUnique({
      where: { id },
      include: {
        stockLocation: { select: { locationName: true } },
        operations: { orderBy: { sequenceNo: 'asc' } },
        parts: { include: { part: { select: { name: true, sku: true } } } },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!order) return jsonResponse(404, { message: `Work order not found: ${id}` });
    const commercialContext = await buildCommercialContext(order);

    const reservations = await getPrisma().$queryRaw<WorkOrderReservationRow[]>`
    SELECT
      r.id::text AS "id",
      r.reservation_status AS "status",
      r.reserved_quantity AS "reservedQuantity",
      r.consumed_quantity AS "consumedQuantity",
      COALESCE(r.allocated_quantity, 0) AS "allocatedQuantity",
      r.reservation_priority AS "reservationPriority",
      r.shortage_reason AS "shortageReason",
      r.expires_at AS "expiresAt",
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt",
      p.id::text AS "partId",
      p.sku AS "partSku",
      p.name AS "partName",
      p.unit_of_measure AS "unitOfMeasure",
      loc.id::text AS "stockLocationId",
      loc.location_name AS "locationName",
      lot.id::text AS "stockLotId",
      lot.lot_number AS "lotNumber",
      lot.serial_number AS "serialNumber",
      r.work_order_id::text AS "workOrderId",
      wo.work_order_number AS "workOrderNumber",
      wo.title AS "workOrderTitle",
      r.work_order_part_id::text AS "workOrderPartId"
    FROM inventory.inventory_reservations r
    JOIN inventory.parts p ON p.id = r.part_id
    JOIN inventory.stock_locations loc ON loc.id = r.stock_location_id
    LEFT JOIN inventory.stock_lots lot ON lot.id = r.stock_lot_id
    LEFT JOIN work_orders.work_orders wo ON wo.id = r.work_order_id
    WHERE r.work_order_id = ${id}::uuid
    ORDER BY
      CASE WHEN r.reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED') THEN 0 ELSE 1 END,
      r.created_at DESC
  `;

    return jsonResponse(200, { workOrder: toDetailItem(order, reservations, commercialContext) });
  },
  { requireAuth: false },
);

// ─── Time Entries (flat list — no workOrderId path param) ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTimeEntryResponse(e: any) {
  const computedHours =
    e.manualHours != null
      ? Number(e.manualHours)
      : e.endedAt
        ? (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / (1000 * 60 * 60)
        : 0;
  return {
    id: e.id,
    workOrderId: e.workOrderId,
    technicianId: e.technicianId,
    startedAt: e.startedAt instanceof Date ? e.startedAt.toISOString() : e.startedAt,
    endedAt: e.endedAt instanceof Date ? e.endedAt.toISOString() : (e.endedAt ?? undefined),
    description: e.description ?? undefined,
    source: e.source,
    computedHours,
  };
}

// ─── Work Orders — full paginated list (all statuses) ─────────────────────────

export const listAllWorkOrdersHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = qs.status as WoStatus | undefined;
    const search = qs.search?.trim();
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 500);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(status ? { status: { equals: status } } : {}),
      ...(search
        ? {
            OR: [
              { workOrderNumber: { contains: search, mode: 'insensitive' as const } },
              { title: { contains: search, mode: 'insensitive' as const } },
              { customerReference: { contains: search, mode: 'insensitive' as const } },
              { assetReference: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      getPrisma().woOrder.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { stockLocation: { select: { locationName: true } } },
      }),
      getPrisma().woOrder.count({ where }),
    ]);

    const items = orders.map((o) => ({
      id: o.id,
      workOrderNumber: o.workOrderNumber,
      title: o.title,
      description: o.description ?? undefined,
      customerReference: o.customerReference ?? undefined,
      assetReference: o.assetReference ?? undefined,
      status: o.status as WoStatus,
      priority: o.priority,
      stockLocationId: o.stockLocationId ?? undefined,
      locationName: o.stockLocation?.locationName ?? undefined,
      openedAt: o.openedAt.toISOString(),
      dueAt: o.dueAt?.toISOString() ?? undefined,
      completedAt: o.completedAt?.toISOString() ?? undefined,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }));

    return jsonResponse(200, { items, total, limit, offset });
  },
  { requireAuth: false },
);

export const listAllTimeEntriesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = qs.workOrderId;
    const technicianId = qs.technicianId;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const entries = await getPrisma().laborTimeEntry.findMany({
      where: {
        ...(workOrderId ? { workOrderId } : {}),
        ...(technicianId ? { technicianId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { entries: entries.map(toTimeEntryResponse) });
  },
  { requireAuth: false },
);
