import { PrismaClient } from '@prisma/client';
import {
  BuildSlotState,
  LaborCapacityState,
  type BuildSlot,
  type LaborCapacity,
} from '../../../../../packages/domain/src/model/buildPlanning.js';
import { InMemoryAuditSink } from '../../audit/index.js';
import { createWorkOrderRoutes } from '../../contexts/build-planning/workOrder.routes.js';
import { PrismaWorkOrderRepository } from '../../contexts/build-planning/workOrder.prisma.repository.js';
import { WorkOrderService } from '../../contexts/build-planning/workOrder.service.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../../events/index.js';
import { ConsoleObservabilityHooks } from '../../observability/index.js';
import {
  buildSlotDemandProjection,
  type BuildSlotCapacityInput,
  type BuildSlotDemandInput,
  type MaterialReadiness,
} from '../../contexts/build-planning/buildSlotProjection.js';

export interface ApiGatewayProxyEventLike {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined> | null;
  httpMethod?: string;
  requestContext?: {
    requestId?: string;
  };
}

export interface ApiGatewayProxyResultLike {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const routes = createWorkOrderRoutes(
  new WorkOrderService({
    repository: new PrismaWorkOrderRepository(),
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  }),
);

let schedulingPrisma: PrismaClient | undefined;
let schedulingProjectionQueriesOverride: SchedulingProjectionQueries | undefined;

function getPrisma(): PrismaClient {
  schedulingPrisma ??= new PrismaClient();
  return schedulingPrisma;
}

export interface SchedulingProjectionQueries {
  listCapacitySlots(input: DateRange): Promise<BuildSlotCapacityInput[]>;
  listOperationDemand(input: DateRange): Promise<BuildSlotDemandInput[]>;
}

export function setSchedulingProjectionQueriesForTests(
  next: SchedulingProjectionQueries | undefined,
): void {
  schedulingProjectionQueriesOverride = next;
}

export async function disconnectSchedulingHandlerDependencies(): Promise<void> {
  await schedulingPrisma?.$disconnect();
  schedulingPrisma = undefined;
  schedulingProjectionQueriesOverride = undefined;
}

// ─── GET /scheduling/slots ──────────────────────────────────────────────────

export async function listBuildSlotsHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const qs = event.queryStringParameters ?? {};

  const startDate = qs.startDate?.trim();
  const endDate = qs.endDate?.trim();
  const state = qs.state?.trim() as BuildSlotState | undefined;
  const workstationCode = qs.workstationCode?.trim();
  const limitParam = qs.limit?.trim();
  const offsetParam = qs.offset?.trim();

  if (state && !Object.values(BuildSlotState).includes(state)) {
    return json(422, {
      message: `Invalid state. Must be one of: ${Object.values(BuildSlotState).join(', ')}`,
    });
  }

  if (startDate && Number.isNaN(Date.parse(startDate))) {
    return json(422, { message: 'startDate must be a valid ISO-8601 date.' });
  }
  if (endDate && Number.isNaN(Date.parse(endDate))) {
    return json(422, { message: 'endDate must be a valid ISO-8601 date.' });
  }

  const limit = limitParam ? Number(limitParam) : undefined;
  const offset = offsetParam ? Number(offsetParam) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return json(422, { message: 'limit must be a positive integer.' });
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    return json(422, { message: 'offset must be a non-negative integer.' });
  }

  const items = await routes.listBuildSlots({
    startDate,
    endDate,
    state,
    workstationCode,
    limit,
    offset,
  });

  return json(200, {
    items: items.map(toBuildSlotResponse),
    total: items.length,
    limit: limit ?? 50,
    offset: offset ?? 0,
  });
}

// ─── GET /scheduling/technician-availability ────────────────────────────────

export async function listLaborCapacityHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const qs = event.queryStringParameters ?? {};

  const startDate = qs.startDate?.trim();
  const endDate = qs.endDate?.trim();
  const state = qs.state?.trim() as LaborCapacityState | undefined;
  const teamCode = qs.teamCode?.trim();
  const limitParam = qs.limit?.trim();
  const offsetParam = qs.offset?.trim();

  if (state && !Object.values(LaborCapacityState).includes(state)) {
    return json(422, {
      message: `Invalid state. Must be one of: ${Object.values(LaborCapacityState).join(', ')}`,
    });
  }

  if (startDate && Number.isNaN(Date.parse(startDate))) {
    return json(422, { message: 'startDate must be a valid ISO-8601 date.' });
  }
  if (endDate && Number.isNaN(Date.parse(endDate))) {
    return json(422, { message: 'endDate must be a valid ISO-8601 date.' });
  }

  const limit = limitParam ? Number(limitParam) : undefined;
  const offset = offsetParam ? Number(offsetParam) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return json(422, { message: 'limit must be a positive integer.' });
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    return json(422, { message: 'offset must be a non-negative integer.' });
  }

  const items = await routes.listLaborCapacity({
    startDate,
    endDate,
    teamCode,
    state,
    limit,
    offset,
  });

  return json(200, {
    items: items.map(toLaborCapacityResponse),
    total: items.length,
    limit: limit ?? 50,
    offset: offset ?? 0,
  });
}

// ─── GET /scheduling/demand-projection ─────────────────────────────────────

export async function getBuildSlotDemandProjectionHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const normalized = normalizeDateRange(event.queryStringParameters ?? {});
  if ('error' in normalized) {
    return json(422, { message: normalized.error });
  }

  const queries = schedulingProjectionQueriesOverride ?? createPrismaProjectionQueries();
  const [slots, demand] = await Promise.all([
    queries.listCapacitySlots(normalized),
    queries.listOperationDemand(normalized),
  ]);

  return json(
    200,
    buildSlotDemandProjection({
      ...normalized,
      slots,
      demand,
    }),
  );
}

// ─── Response mappers ───────────────────────────────────────────────────────

function toBuildSlotResponse(slot: BuildSlot) {
  return {
    id: slot.id,
    slotDate: slot.slotDate,
    workstationCode: slot.workstationCode,
    state: slot.state,
    capacityHours: slot.capacityHours,
    usedHours: slot.usedHours,
    remainingHours: slot.capacityHours - slot.usedHours,
    updatedAt: slot.updatedAt,
  };
}

function toLaborCapacityResponse(capacity: LaborCapacity) {
  return {
    id: capacity.id,
    capacityDate: capacity.capacityDate,
    teamCode: capacity.teamCode,
    state: capacity.state,
    availableHours: capacity.availableHours,
    allocatedHours: capacity.allocatedHours,
    remainingHours: capacity.availableHours - capacity.allocatedHours,
    updatedAt: capacity.updatedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface DateRange {
  startDate: string;
  endDate: string;
}

interface CapacitySlotRow {
  slotId: string;
  slotStart: Date | string;
  slotEnd: Date | string;
  stockLocationId: string | null;
  bayCode: string | null;
  teamCode: string | null;
  status: string;
  capacityMinutes: number;
  allocatedMinutes: number;
  updatedAt: Date | string | null;
}

const ACTIVE_WO_STATUSES = ['READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED'] as const;
const ACTIVE_OPERATION_STATUSES = ['PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED'] as const;

function createPrismaProjectionQueries(): SchedulingProjectionQueries {
  return {
    async listCapacitySlots(input) {
      const start = startOfDate(input.startDate);
      const end = addDays(startOfDate(input.endDate), 1);

      try {
        const rows = await getPrisma().$queryRaw<CapacitySlotRow[]>`
          SELECT
            id::text AS "slotId",
            slot_start AS "slotStart",
            slot_end AS "slotEnd",
            stock_location_id::text AS "stockLocationId",
            bay_code AS "bayCode",
            team_code AS "teamCode",
            slot_status AS "status",
            capacity_minutes AS "capacityMinutes",
            allocated_minutes AS "allocatedMinutes",
            updated_at AS "updatedAt"
          FROM planning.capacity_slots
          WHERE slot_start >= ${start}
            AND slot_start < ${end}
            AND slot_status NOT IN ('CANCELLED', 'CLOSED')
          ORDER BY slot_start ASC, COALESCE(bay_code, ''), COALESCE(team_code, ''), id ASC
        `;
        return rows.map(toCapacityInput);
      } catch (error) {
        if (isMissingCapacityTableError(error)) {
          return [];
        }
        throw error;
      }
    },
    async listOperationDemand(input) {
      const start = startOfDate(input.startDate);
      const end = addDays(startOfDate(input.endDate), 1);

      const orders = await getPrisma().woOrder.findMany({
        where: {
          status: { in: [...ACTIVE_WO_STATUSES] },
        },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { workOrderNumber: 'asc' }],
        take: 250,
        include: {
          operations: {
            where: {
              operationStatus: { in: [...ACTIVE_OPERATION_STATUSES] },
              OR: [
                { plannedStartAt: null },
                { plannedStartAt: { gte: start, lt: end } },
              ],
            },
            orderBy: { sequenceNo: 'asc' },
          },
          parts: true,
        },
      });

      return orders.flatMap((order) => {
        const materialReadiness = summarizeMaterialReadiness(order.parts ?? []);
        return (order.operations ?? []).map((operation) => ({
          workOrderId: order.id,
          workOrderNumber: order.workOrderNumber,
          title: order.title,
          status: order.status,
          priority: order.priority,
          dueAt: toOptionalIso(order.dueAt),
          materialReadiness,
          operationId: operation.id,
          operationCode: operation.operationCode,
          operationName: operation.operationName,
          sequenceNo: operation.sequenceNo,
          operationStatus: operation.operationStatus,
          requiredSkillCode: operation.requiredSkillCode ?? undefined,
          estimatedMinutes: operation.estimatedMinutes,
          plannedStartAt: toOptionalIso(operation.plannedStartAt),
          plannedEndAt: toOptionalIso(operation.plannedEndAt),
        }));
      });
    },
  };
}

function normalizeDateRange(
  qs: Record<string, string | undefined>,
): DateRange | { error: string } {
  const defaults = defaultWeekRange(new Date());
  const startDate = qs.startDate?.trim() || defaults.startDate;
  const endDate = qs.endDate?.trim() || defaults.endDate;

  if (!isDateOnly(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00.000Z`))) {
    return { error: 'startDate must be a valid YYYY-MM-DD date.' };
  }
  if (!isDateOnly(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00.000Z`))) {
    return { error: 'endDate must be a valid YYYY-MM-DD date.' };
  }
  if (startOfDate(startDate).getTime() > startOfDate(endDate).getTime()) {
    return { error: 'startDate cannot be after endDate.' };
  }

  return { startDate, endDate };
}

function defaultWeekRange(now: Date): DateRange {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  const end = addDays(date, 4);
  return {
    startDate: date.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function startOfDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toCapacityInput(row: CapacitySlotRow): BuildSlotCapacityInput {
  return {
    slotId: row.slotId,
    slotStart: toIso(row.slotStart),
    slotEnd: toIso(row.slotEnd),
    stockLocationId: row.stockLocationId ?? undefined,
    bayCode: row.bayCode ?? undefined,
    teamCode: row.teamCode ?? undefined,
    status: row.status,
    capacityMinutes: Number(row.capacityMinutes),
    allocatedMinutes: Number(row.allocatedMinutes),
    updatedAt: row.updatedAt ? toIso(row.updatedAt) : undefined,
  };
}

function summarizeMaterialReadiness(parts: unknown[]): MaterialReadiness {
  if (parts.length === 0) return 'READY';

  let hasOpenQuantity = false;
  for (const part of parts as Array<{
    partStatus?: string;
    requestedQuantity?: unknown;
    reservedQuantity?: unknown;
    consumedQuantity?: unknown;
  }>) {
    if (part.partStatus === 'SHORT') return 'NOT_READY';
    const requested = toNumber(part.requestedQuantity);
    const reserved = toNumber(part.reservedQuantity);
    const consumed = toNumber(part.consumedQuantity);
    if (requested > reserved + consumed) {
      hasOpenQuantity = true;
    }
  }

  return hasOpenQuantity ? 'PARTIAL' : 'READY';
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return Number((value as { toNumber(): number }).toNumber());
  }
  return Number(value ?? 0);
}

function toOptionalIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return toIso(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isMissingCapacityTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('planning.capacity_slots') &&
    (message.includes('does not exist') || message.includes('relation'))
  );
}

function json(statusCode: number, payload: unknown): ApiGatewayProxyResultLike {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}
