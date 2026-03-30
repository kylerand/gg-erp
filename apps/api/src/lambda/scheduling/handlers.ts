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

function json(statusCode: number, payload: unknown): ApiGatewayProxyResultLike {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}
