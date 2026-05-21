import { Prisma, PrismaClient } from '@prisma/client';
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
let schedulingCapacityStoreOverride: SchedulingCapacitySlotStore | undefined;

function getPrisma(): PrismaClient {
  schedulingPrisma ??= new PrismaClient();
  return schedulingPrisma;
}

export interface SchedulingProjectionQueries {
  listCapacitySlots(input: DateRange): Promise<BuildSlotCapacityInput[]>;
  listOperationDemand(input: DateRange): Promise<BuildSlotDemandInput[]>;
}

export type CapacitySlotStatus = 'OPEN' | 'LOCKED' | 'EXECUTING' | 'CLOSED' | 'CANCELLED';

export interface CapacitySlotResponse {
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

export interface CapacityStockLocationOption {
  id: string;
  locationCode: string;
  locationName: string;
  locationType: string;
}

export interface CapacitySlotListInput extends DateRange {
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  status?: CapacitySlotStatus;
  limit: number;
  offset: number;
}

export interface CapacitySlotListResult {
  items: CapacitySlotResponse[];
  total: number;
  limit: number;
  offset: number;
  stockLocations: CapacityStockLocationOption[];
}

export interface CreateCapacitySlotInput {
  slotStart: string;
  slotEnd: string;
  stockLocationId: string;
  bayCode?: string;
  teamCode?: string;
  slotStatus?: CapacitySlotStatus;
  capacityMinutes: number;
}

export interface UpdateCapacitySlotInput {
  slotStart?: string;
  slotEnd?: string;
  stockLocationId?: string;
  bayCode?: string | null;
  teamCode?: string | null;
  slotStatus?: CapacitySlotStatus;
  capacityMinutes?: number;
  expectedVersion: number;
}

export interface CancelCapacitySlotInput {
  expectedVersion: number;
}

export interface CapacitySlotImportRowInput {
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

export interface ImportCapacitySlotsInput extends DateRange {
  rows: CapacitySlotImportRowInput[];
}

export interface CapacitySlotImportError {
  rowNumber: number;
  message: string;
}

export interface CapacitySlotImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: CapacitySlotImportError[];
  items: CapacitySlotResponse[];
}

export interface SchedulingCapacitySlotStore {
  listCapacitySlots(input: CapacitySlotListInput): Promise<CapacitySlotListResult>;
  createCapacitySlot(input: CreateCapacitySlotInput, context: MutationContext): Promise<CapacitySlotResponse>;
  updateCapacitySlot(id: string, input: UpdateCapacitySlotInput, context: MutationContext): Promise<CapacitySlotResponse>;
  cancelCapacitySlot(id: string, input: CancelCapacitySlotInput, context: MutationContext): Promise<CapacitySlotResponse>;
  upsertCapacitySlot(input: CreateCapacitySlotInput, context: MutationContext): Promise<{ item: CapacitySlotResponse; created: boolean }>;
}

export function setSchedulingProjectionQueriesForTests(
  next: SchedulingProjectionQueries | undefined,
): void {
  schedulingProjectionQueriesOverride = next;
}

export function setSchedulingCapacityStoreForTests(
  next: SchedulingCapacitySlotStore | undefined,
): void {
  schedulingCapacityStoreOverride = next;
}

export async function disconnectSchedulingHandlerDependencies(): Promise<void> {
  await schedulingPrisma?.$disconnect();
  schedulingPrisma = undefined;
  schedulingProjectionQueriesOverride = undefined;
  schedulingCapacityStoreOverride = undefined;
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

// ─── planning.capacity_slots management ────────────────────────────────────

export async function listCapacitySlotsHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const parsed = parseCapacitySlotListInput(event.queryStringParameters ?? {});
  if ('error' in parsed) {
    return json(422, { message: parsed.error });
  }

  const result = await getCapacitySlotStore().listCapacitySlots(parsed);
  return json(200, result);
}

export async function createCapacitySlotHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const body = parseJsonObject(event.body);
    const input = parseCreateCapacitySlotInput(body);
    const item = await getCapacitySlotStore().createCapacitySlot(input, mutationContext(event));
    return json(201, { item });
  } catch (error) {
    return capacityErrorResponse(error);
  }
}

export async function updateCapacitySlotHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const id = parseRequiredUuid(event.pathParameters?.id, 'id');
    const body = parseJsonObject(event.body);
    const input = parseUpdateCapacitySlotInput(body);
    const item = await getCapacitySlotStore().updateCapacitySlot(id, input, mutationContext(event));
    return json(200, { item });
  } catch (error) {
    return capacityErrorResponse(error);
  }
}

export async function cancelCapacitySlotHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const id = parseRequiredUuid(event.pathParameters?.id, 'id');
    const body = parseJsonObject(event.body);
    const input = parseCancelCapacitySlotInput(body);
    const item = await getCapacitySlotStore().cancelCapacitySlot(id, input, mutationContext(event));
    return json(200, { item });
  } catch (error) {
    return capacityErrorResponse(error);
  }
}

export async function importCapacitySlotsHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const body = parseJsonObject(event.body);
    const input = parseImportCapacitySlotsInput(body);
    const result = await importCapacitySlots(input, mutationContext(event));
    const projection = await buildProjectionForRange({
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return json(200, { ...result, projection });
  } catch (error) {
    return capacityErrorResponse(error);
  }
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

export interface MutationContext {
  correlationId: string;
  requestId?: string;
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

interface PersistedCapacitySlotRow {
  id: string;
  slotStart: Date | string;
  slotEnd: Date | string;
  stockLocationId: string;
  stockLocationCode: string;
  stockLocationName: string;
  stockLocationType: string;
  bayCode: string | null;
  teamCode: string | null;
  slotStatus: CapacitySlotStatus;
  capacityMinutes: number;
  allocatedMinutes: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
  inserted?: boolean;
}

interface CapacitySlotCountRow {
  total: number | bigint;
}

interface StockLocationRow {
  id: string;
  locationCode: string;
  locationName: string;
  locationType: string;
}

const ACTIVE_WO_STATUSES = ['READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED'] as const;
const ACTIVE_OPERATION_STATUSES = ['PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED'] as const;
const CAPACITY_SLOT_STATUSES: CapacitySlotStatus[] = [
  'OPEN',
  'LOCKED',
  'EXECUTING',
  'CLOSED',
  'CANCELLED',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CapacitySlotError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function getCapacitySlotStore(): SchedulingCapacitySlotStore {
  return schedulingCapacityStoreOverride ?? createPrismaCapacitySlotStore();
}

function createPrismaCapacitySlotStore(): SchedulingCapacitySlotStore {
  return {
    async listCapacitySlots(input) {
      const start = startOfDate(input.startDate);
      const end = addDays(startOfDate(input.endDate), 1);
      const where: Prisma.Sql[] = [
        Prisma.sql`s.slot_start >= ${start}`,
        Prisma.sql`s.slot_start < ${end}`,
      ];

      if (input.stockLocationId) {
        where.push(Prisma.sql`s.stock_location_id = ${input.stockLocationId}::uuid`);
      }
      if (input.bayCode) {
        where.push(Prisma.sql`lower(coalesce(s.bay_code, '')) = lower(${input.bayCode})`);
      }
      if (input.teamCode) {
        where.push(Prisma.sql`lower(coalesce(s.team_code, '')) = lower(${input.teamCode})`);
      }
      if (input.status) {
        where.push(Prisma.sql`s.slot_status = ${input.status}`);
      }

      const query = Prisma.sql`
        SELECT
          s.id::text AS "id",
          s.slot_start AS "slotStart",
          s.slot_end AS "slotEnd",
          s.stock_location_id::text AS "stockLocationId",
          loc.location_code AS "stockLocationCode",
          loc.location_name AS "stockLocationName",
          loc.location_type AS "stockLocationType",
          s.bay_code AS "bayCode",
          s.team_code AS "teamCode",
          s.slot_status AS "slotStatus",
          s.capacity_minutes AS "capacityMinutes",
          s.allocated_minutes AS "allocatedMinutes",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.version AS "version"
        FROM planning.capacity_slots s
        JOIN inventory.stock_locations loc ON loc.id = s.stock_location_id
        WHERE ${Prisma.join(where, ' AND ')}
        ORDER BY s.slot_start ASC, loc.location_code ASC, coalesce(s.bay_code, ''), s.id ASC
        LIMIT ${input.limit}
        OFFSET ${input.offset}
      `;
      const countQuery = Prisma.sql`
        SELECT COUNT(*)::int AS "total"
        FROM planning.capacity_slots s
        JOIN inventory.stock_locations loc ON loc.id = s.stock_location_id
        WHERE ${Prisma.join(where, ' AND ')}
      `;

      const [rows, countRows, stockLocations] = await Promise.all([
        getPrisma().$queryRaw<PersistedCapacitySlotRow[]>(query),
        getPrisma().$queryRaw<CapacitySlotCountRow[]>(countQuery),
        listCapacityStockLocations(),
      ]);

      return {
        items: rows.map(toPersistedCapacitySlotResponse),
        total: Number(countRows[0]?.total ?? rows.length),
        limit: input.limit,
        offset: input.offset,
        stockLocations,
      };
    },

    async createCapacitySlot(input, context) {
      const rows = await getPrisma().$queryRaw<PersistedCapacitySlotRow[]>`
        WITH inserted AS (
          INSERT INTO planning.capacity_slots (
            slot_start,
            slot_end,
            stock_location_id,
            bay_code,
            team_code,
            slot_status,
            capacity_minutes,
            correlation_id,
            request_id
          )
          VALUES (
            ${new Date(input.slotStart)},
            ${new Date(input.slotEnd)},
            ${input.stockLocationId}::uuid,
            ${input.bayCode ?? null},
            ${input.teamCode ?? null},
            ${input.slotStatus ?? 'OPEN'},
            ${input.capacityMinutes},
            ${context.correlationId},
            ${context.requestId ?? null}
          )
          ON CONFLICT (stock_location_id, (coalesce(bay_code, ''::text)), slot_start, slot_end)
          DO NOTHING
          RETURNING *
        )
        SELECT ${capacitySlotSelectColumns('inserted')}
        FROM inserted
        JOIN inventory.stock_locations loc ON loc.id = inserted.stock_location_id
      `;
      if (!rows[0]) {
        throw new CapacitySlotError(409, 'A capacity slot already exists for that location, bay, and time window.');
      }
      return toPersistedCapacitySlotResponse(rows[0]);
    },

    async updateCapacitySlot(id, input, context) {
      const setClauses = capacitySlotUpdateSetClauses(input);
      if (setClauses.length === 0) {
        throw new CapacitySlotError(422, 'At least one capacity slot field must be provided.');
      }
      setClauses.push(
        Prisma.sql`updated_at = now()`,
        Prisma.sql`correlation_id = ${context.correlationId}`,
        Prisma.sql`request_id = ${context.requestId ?? null}`,
        Prisma.sql`version = version + 1`,
      );

      const rows = await getPrisma().$queryRaw<PersistedCapacitySlotRow[]>(Prisma.sql`
        WITH updated AS (
          UPDATE planning.capacity_slots
          SET ${Prisma.join(setClauses, ', ')}
          WHERE id = ${id}::uuid
            AND version = ${input.expectedVersion}
          RETURNING *
        )
        SELECT ${capacitySlotSelectColumns('updated')}
        FROM updated
        JOIN inventory.stock_locations loc ON loc.id = updated.stock_location_id
      `);
      if (!rows[0]) {
        throw new CapacitySlotError(409, 'Capacity slot was not updated. Refresh and retry with the latest version.');
      }
      return toPersistedCapacitySlotResponse(rows[0]);
    },

    async cancelCapacitySlot(id, input, context) {
      return this.updateCapacitySlot(
        id,
        { expectedVersion: input.expectedVersion, slotStatus: 'CANCELLED' },
        context,
      );
    },

    async upsertCapacitySlot(input, context) {
      const rows = await getPrisma().$queryRaw<PersistedCapacitySlotRow[]>`
        WITH upserted AS (
          INSERT INTO planning.capacity_slots (
            slot_start,
            slot_end,
            stock_location_id,
            bay_code,
            team_code,
            slot_status,
            capacity_minutes,
            correlation_id,
            request_id
          )
          VALUES (
            ${new Date(input.slotStart)},
            ${new Date(input.slotEnd)},
            ${input.stockLocationId}::uuid,
            ${input.bayCode ?? null},
            ${input.teamCode ?? null},
            ${input.slotStatus ?? 'OPEN'},
            ${input.capacityMinutes},
            ${context.correlationId},
            ${context.requestId ?? null}
          )
          ON CONFLICT (stock_location_id, (coalesce(bay_code, ''::text)), slot_start, slot_end)
          DO UPDATE SET
            team_code = EXCLUDED.team_code,
            slot_status = EXCLUDED.slot_status,
            capacity_minutes = EXCLUDED.capacity_minutes,
            updated_at = now(),
            correlation_id = EXCLUDED.correlation_id,
            request_id = EXCLUDED.request_id,
            version = planning.capacity_slots.version + 1
          WHERE planning.capacity_slots.allocated_minutes <= EXCLUDED.capacity_minutes
          RETURNING *, (xmax = 0) AS inserted
        )
        SELECT ${capacitySlotSelectColumns('upserted')}, upserted.inserted AS "inserted"
        FROM upserted
        JOIN inventory.stock_locations loc ON loc.id = upserted.stock_location_id
      `;
      if (!rows[0]) {
        throw new CapacitySlotError(
          409,
          'Capacity slot was not imported because capacityMinutes is below allocatedMinutes.',
        );
      }
      return { item: toPersistedCapacitySlotResponse(rows[0]), created: Boolean(rows[0].inserted) };
    },
  };
}

function capacitySlotSelectColumns(alias: string): Prisma.Sql {
  const table = Prisma.raw(alias);
  return Prisma.sql`
    ${table}.id::text AS "id",
    ${table}.slot_start AS "slotStart",
    ${table}.slot_end AS "slotEnd",
    ${table}.stock_location_id::text AS "stockLocationId",
    loc.location_code AS "stockLocationCode",
    loc.location_name AS "stockLocationName",
    loc.location_type AS "stockLocationType",
    ${table}.bay_code AS "bayCode",
    ${table}.team_code AS "teamCode",
    ${table}.slot_status AS "slotStatus",
    ${table}.capacity_minutes AS "capacityMinutes",
    ${table}.allocated_minutes AS "allocatedMinutes",
    ${table}.created_at AS "createdAt",
    ${table}.updated_at AS "updatedAt",
    ${table}.version AS "version"
  `;
}

function capacitySlotUpdateSetClauses(input: UpdateCapacitySlotInput): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (input.slotStart) clauses.push(Prisma.sql`slot_start = ${new Date(input.slotStart)}`);
  if (input.slotEnd) clauses.push(Prisma.sql`slot_end = ${new Date(input.slotEnd)}`);
  if (input.stockLocationId) clauses.push(Prisma.sql`stock_location_id = ${input.stockLocationId}::uuid`);
  if ('bayCode' in input) clauses.push(Prisma.sql`bay_code = ${input.bayCode ?? null}`);
  if ('teamCode' in input) clauses.push(Prisma.sql`team_code = ${input.teamCode ?? null}`);
  if (input.slotStatus) clauses.push(Prisma.sql`slot_status = ${input.slotStatus}`);
  if (input.capacityMinutes !== undefined) {
    clauses.push(Prisma.sql`capacity_minutes = ${input.capacityMinutes}`);
  }
  return clauses;
}

async function listCapacityStockLocations(): Promise<CapacityStockLocationOption[]> {
  const rows = await getPrisma().$queryRaw<StockLocationRow[]>`
    SELECT
      id::text AS "id",
      location_code AS "locationCode",
      location_name AS "locationName",
      location_type AS "locationType"
    FROM inventory.stock_locations
    WHERE deleted_at IS NULL
      AND location_type IN ('WAREHOUSE', 'BAY', 'STAGING')
    ORDER BY is_pickable DESC, location_type ASC, location_code ASC
  `;
  return rows;
}

async function importCapacitySlots(
  input: ImportCapacitySlotsInput,
  context: MutationContext,
): Promise<CapacitySlotImportResult> {
  const store = getCapacitySlotStore();
  const locations = (
    await store.listCapacitySlots({
      startDate: input.startDate,
      endDate: input.endDate,
      limit: 1,
      offset: 0,
    })
  ).stockLocations;
  const locationsByCode = new Map(locations.map((location) => [
    location.locationCode.toLowerCase(),
    location,
  ]));
  const seen = new Set<string>();
  const result: CapacitySlotImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const rowNumber = row.rowNumber ?? index + 1;
    const normalized = normalizeImportRow(row, rowNumber, locationsByCode);
    if ('error' in normalized) {
      result.errors.push({ rowNumber, message: normalized.error });
      continue;
    }

    const key = [
      normalized.stockLocationId,
      normalized.bayCode ?? '',
      normalized.slotStart,
      normalized.slotEnd,
    ].join('|');
    if (seen.has(key)) {
      result.skipped += 1;
      result.errors.push({ rowNumber, message: 'Duplicate capacity slot in this import file.' });
      continue;
    }
    seen.add(key);

    try {
      const upserted = await store.upsertCapacitySlot(normalized, context);
      result.items.push(upserted.item);
      if (upserted.created) result.imported += 1;
      else result.updated += 1;
    } catch (error) {
      if (error instanceof CapacitySlotError) {
        result.errors.push({ rowNumber, message: error.message });
        continue;
      }
      throw error;
    }
  }

  return result;
}

async function buildProjectionForRange(range: DateRange): Promise<ReturnType<typeof buildSlotDemandProjection>> {
  const demandQueries = schedulingProjectionQueriesOverride ?? createPrismaProjectionQueries();
  const [slots, demand] = await Promise.all([
    listProjectionCapacitySlots(range),
    demandQueries.listOperationDemand(range),
  ]);
  return buildSlotDemandProjection({ ...range, slots, demand });
}

async function listProjectionCapacitySlots(range: DateRange): Promise<BuildSlotCapacityInput[]> {
  if (!schedulingCapacityStoreOverride) {
    return createPrismaProjectionQueries().listCapacitySlots(range);
  }

  const result = await schedulingCapacityStoreOverride.listCapacitySlots({
    ...range,
    limit: 500,
    offset: 0,
  });
  return result.items
    .filter((slot) => slot.slotStatus !== 'CANCELLED' && slot.slotStatus !== 'CLOSED')
    .map((slot) => ({
      slotId: slot.id,
      slotStart: slot.slotStart,
      slotEnd: slot.slotEnd,
      stockLocationId: slot.stockLocationId,
      bayCode: slot.bayCode,
      teamCode: slot.teamCode,
      status: slot.slotStatus,
      capacityMinutes: slot.capacityMinutes,
      allocatedMinutes: slot.allocatedMinutes,
      updatedAt: slot.updatedAt,
    }));
}

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

function parseCapacitySlotListInput(
  qs: Record<string, string | undefined>,
): CapacitySlotListInput | { error: string } {
  const range = normalizeDateRange(qs);
  if ('error' in range) return range;

  const limit = parseInteger(qs.limit, 100, 'limit');
  if ('error' in limit) return limit;
  const offset = parseInteger(qs.offset, 0, 'offset');
  if ('error' in offset) return offset;
  if (limit.value <= 0 || limit.value > 500) {
    return { error: 'limit must be between 1 and 500.' };
  }
  if (offset.value < 0) {
    return { error: 'offset must be a non-negative integer.' };
  }

  const stockLocationId = qs.stockLocationId?.trim();
  if (stockLocationId && !UUID_PATTERN.test(stockLocationId)) {
    return { error: 'stockLocationId must be a UUID.' };
  }

  const status = qs.status?.trim() as CapacitySlotStatus | undefined;
  if (status && !CAPACITY_SLOT_STATUSES.includes(status)) {
    return { error: `status must be one of: ${CAPACITY_SLOT_STATUSES.join(', ')}.` };
  }

  return {
    ...range,
    stockLocationId,
    bayCode: normalizeOptionalText(qs.bayCode),
    teamCode: normalizeOptionalText(qs.teamCode),
    status,
    limit: limit.value,
    offset: offset.value,
  };
}

function parseCreateCapacitySlotInput(body: Record<string, unknown>): CreateCapacitySlotInput {
  const slotStart = parseRequiredDateTime(body.slotStart, 'slotStart');
  const slotEnd = parseRequiredDateTime(body.slotEnd, 'slotEnd');
  validateSlotWindow(slotStart, slotEnd);

  const stockLocationId = parseRequiredUuid(body.stockLocationId, 'stockLocationId');
  const capacityMinutes = parseRequiredPositiveInteger(body.capacityMinutes, 'capacityMinutes');
  const slotStatus = parseOptionalCapacityStatus(body.slotStatus);

  return {
    slotStart,
    slotEnd,
    stockLocationId,
    bayCode: normalizeOptionalText(body.bayCode),
    teamCode: normalizeOptionalText(body.teamCode),
    slotStatus,
    capacityMinutes,
  };
}

function parseUpdateCapacitySlotInput(body: Record<string, unknown>): UpdateCapacitySlotInput {
  const expectedVersion = parseRequiredNonNegativeInteger(body.expectedVersion, 'expectedVersion');
  const input: UpdateCapacitySlotInput = { expectedVersion };
  const hasSlotStart = Object.prototype.hasOwnProperty.call(body, 'slotStart');
  const hasSlotEnd = Object.prototype.hasOwnProperty.call(body, 'slotEnd');
  if (hasSlotStart !== hasSlotEnd) {
    throw new CapacitySlotError(422, 'slotStart and slotEnd must be updated together.');
  }
  if (hasSlotStart && hasSlotEnd) {
    input.slotStart = parseRequiredDateTime(body.slotStart, 'slotStart');
    input.slotEnd = parseRequiredDateTime(body.slotEnd, 'slotEnd');
    validateSlotWindow(input.slotStart, input.slotEnd);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'stockLocationId')) {
    input.stockLocationId = parseRequiredUuid(body.stockLocationId, 'stockLocationId');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'bayCode')) {
    input.bayCode = normalizeNullableText(body.bayCode);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'teamCode')) {
    input.teamCode = normalizeNullableText(body.teamCode);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'slotStatus')) {
    input.slotStatus = parseOptionalCapacityStatus(body.slotStatus, true);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'capacityMinutes')) {
    input.capacityMinutes = parseRequiredPositiveInteger(body.capacityMinutes, 'capacityMinutes');
  }
  return input;
}

function parseCancelCapacitySlotInput(body: Record<string, unknown>): CancelCapacitySlotInput {
  return {
    expectedVersion: parseRequiredNonNegativeInteger(body.expectedVersion, 'expectedVersion'),
  };
}

function parseImportCapacitySlotsInput(body: Record<string, unknown>): ImportCapacitySlotsInput {
  const range = normalizeDateRange({
    startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body.endDate === 'string' ? body.endDate : undefined,
  });
  if ('error' in range) {
    throw new CapacitySlotError(422, range.error);
  }
  if (!Array.isArray(body.rows)) {
    throw new CapacitySlotError(422, 'rows must be an array.');
  }
  if (body.rows.length === 0) {
    throw new CapacitySlotError(422, 'At least one capacity row is required.');
  }
  if (body.rows.length > 250) {
    throw new CapacitySlotError(422, 'Capacity imports are limited to 250 rows.');
  }
  return {
    ...range,
    rows: body.rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new CapacitySlotError(422, `rows[${index}] must be an object.`);
      }
      return row as CapacitySlotImportRowInput;
    }),
  };
}

function normalizeImportRow(
  row: CapacitySlotImportRowInput,
  rowNumber: number,
  locationsByCode: Map<string, CapacityStockLocationOption>,
): CreateCapacitySlotInput | { error: string } {
  try {
    const slotStart = row.slotStart
      ? parseRequiredDateTime(row.slotStart, 'slotStart')
      : combineDateAndTime(row.date, row.startTime, 'startTime');
    const slotEnd = row.slotEnd
      ? parseRequiredDateTime(row.slotEnd, 'slotEnd')
      : combineDateAndTime(row.date, row.endTime, 'endTime');
    validateSlotWindow(slotStart, slotEnd);

    let stockLocationId = normalizeOptionalText(row.stockLocationId);
    if (stockLocationId) {
      stockLocationId = parseRequiredUuid(stockLocationId, 'stockLocationId');
    } else {
      const locationCode = normalizeOptionalText(row.locationCode);
      if (!locationCode) {
        throw new CapacitySlotError(422, 'stockLocationId or locationCode is required.');
      }
      const location = locationsByCode.get(locationCode.toLowerCase());
      if (!location) {
        throw new CapacitySlotError(422, `Unknown locationCode: ${locationCode}.`);
      }
      stockLocationId = location.id;
    }

    const capacityMinutes =
      row.capacityMinutes !== undefined
        ? parseRequiredPositiveInteger(row.capacityMinutes, 'capacityMinutes')
        : Math.round(parseRequiredPositiveNumber(row.capacityHours, 'capacityHours') * 60);

    return {
      slotStart,
      slotEnd,
      stockLocationId,
      bayCode: normalizeOptionalText(row.bayCode),
      teamCode: normalizeOptionalText(row.teamCode),
      slotStatus: parseOptionalCapacityStatus(row.slotStatus),
      capacityMinutes,
    };
  } catch (error) {
    if (error instanceof CapacitySlotError) return { error: error.message };
    return { error: `Row ${rowNumber} could not be parsed.` };
  }
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

function parseJsonObject(body: string | null | undefined): Record<string, unknown> {
  if (!body?.trim()) {
    throw new CapacitySlotError(422, 'Request body is required.');
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CapacitySlotError(422, 'Request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CapacitySlotError) throw error;
    throw new CapacitySlotError(400, 'Request body must be valid JSON.');
  }
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  field: string,
): { value: number } | { error: string } {
  if (value === undefined || value.trim() === '') return { value: fallback };
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return { error: `${field} must be an integer.` };
  return { value: parsed };
}

function parseRequiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CapacitySlotError(422, `${field} is required.`);
  }
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new CapacitySlotError(422, `${field} must be a UUID.`);
  }
  return trimmed;
}

function parseRequiredDateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CapacitySlotError(422, `${field} is required.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CapacitySlotError(422, `${field} must be a valid ISO-8601 datetime.`);
  }
  return parsed.toISOString();
}

function parseRequiredPositiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) <= 0) {
    throw new CapacitySlotError(422, `${field} must be a positive integer.`);
  }
  return Number(parsed);
}

function parseRequiredNonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) < 0) {
    throw new CapacitySlotError(422, `${field} must be a non-negative integer.`);
  }
  return Number(parsed);
}

function parseRequiredPositiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new CapacitySlotError(422, `${field} must be a positive number.`);
  }
  return parsed;
}

function parseOptionalCapacityStatus(
  value: unknown,
  required = false,
): CapacitySlotStatus | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new CapacitySlotError(422, 'slotStatus is required.');
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new CapacitySlotError(422, `slotStatus must be one of: ${CAPACITY_SLOT_STATUSES.join(', ')}.`);
  }
  const status = value.trim().toUpperCase() as CapacitySlotStatus;
  if (!CAPACITY_SLOT_STATUSES.includes(status)) {
    throw new CapacitySlotError(422, `slotStatus must be one of: ${CAPACITY_SLOT_STATUSES.join(', ')}.`);
  }
  return status;
}

function validateSlotWindow(slotStart: string, slotEnd: string): void {
  if (new Date(slotEnd).getTime() <= new Date(slotStart).getTime()) {
    throw new CapacitySlotError(422, 'slotEnd must be after slotStart.');
  }
}

function combineDateAndTime(date: unknown, time: unknown, field: string): string {
  if (typeof date !== 'string' || !isDateOnly(date.trim())) {
    throw new CapacitySlotError(422, 'date must be a YYYY-MM-DD value.');
  }
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time.trim())) {
    throw new CapacitySlotError(422, `${field} must be an HH:mm value.`);
  }
  return parseRequiredDateTime(`${date.trim()}T${time.trim()}:00`, field);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function startOfDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toPersistedCapacitySlotResponse(row: PersistedCapacitySlotRow): CapacitySlotResponse {
  const slotStart = toIso(row.slotStart);
  const slotEnd = toIso(row.slotEnd);
  return {
    id: row.id,
    slotStart,
    slotEnd,
    date: slotStart.slice(0, 10),
    stockLocationId: row.stockLocationId,
    stockLocationCode: row.stockLocationCode,
    stockLocationName: row.stockLocationName,
    stockLocationType: row.stockLocationType,
    bayCode: row.bayCode ?? undefined,
    teamCode: row.teamCode ?? undefined,
    slotStatus: row.slotStatus,
    capacityMinutes: Number(row.capacityMinutes),
    allocatedMinutes: Number(row.allocatedMinutes),
    remainingMinutes: Number(row.capacityMinutes) - Number(row.allocatedMinutes),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: Number(row.version),
  };
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

function mutationContext(event: ApiGatewayProxyEventLike): MutationContext {
  return {
    correlationId:
      getHeader(event, 'x-correlation-id') ??
      getHeader(event, 'idempotency-key') ??
      event.requestContext?.requestId ??
      `capacity-${Date.now()}`,
    requestId: event.requestContext?.requestId,
  };
}

function getHeader(event: ApiGatewayProxyEventLike, name: string): string | undefined {
  const headers = event.headers ?? {};
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1]?.trim() || undefined;
}

function capacityErrorResponse(error: unknown): ApiGatewayProxyResultLike {
  if (error instanceof CapacitySlotError) {
    return json(error.statusCode, { message: error.message });
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('capacity_slots_allocated_ck')) {
    return json(409, { message: 'capacityMinutes cannot be lower than allocatedMinutes.' });
  }
  if (message.includes('capacity_slots_window_ck')) {
    return json(422, { message: 'slotEnd must be after slotStart.' });
  }
  if (message.includes('foreign key') && message.includes('stock_location_id')) {
    return json(422, { message: 'stockLocationId must reference an active stock location.' });
  }
  if (message.includes('capacity_slots_dimension_uk') || message.includes('duplicate key')) {
    return json(409, { message: 'A capacity slot already exists for that location, bay, and time window.' });
  }

  throw error;
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
