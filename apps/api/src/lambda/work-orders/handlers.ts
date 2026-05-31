import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  InvariantViolationError,
  WorkOrderState,
} from '../../../../../packages/domain/src/model/index.js';
import { InMemoryAuditSink } from '../../audit/index.js';
import { createWorkOrderRoutes } from '../../contexts/build-planning/workOrder.routes.js';
import {
  toWorkOrderCreatedEvent,
  toWorkOrderResponse,
  type CreateWorkOrderRequest,
  type ListBuildPackagesQuery,
  type ListBuildPackagesResponse,
  type CreateWorkOrderResponse,
  type ListWorkOrdersQuery,
  type ListWorkOrdersResponse,
  type WorkOrderBuildPackageResponse,
  type WorkOrderResponse,
} from '../../contexts/build-planning/workOrder.contracts.js';
import { PrismaWorkOrderRepository } from '../../contexts/build-planning/workOrder.prisma.repository.js';
import { WorkOrderService } from '../../contexts/build-planning/workOrder.service.js';
import {
  validateCreateWorkOrderRequest,
  validateListWorkOrdersQuery,
} from '../../contexts/build-planning/workOrder.validation.js';
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

const prisma = new PrismaClient();

const routes = createWorkOrderRoutes(
  new WorkOrderService({
    repository: new PrismaWorkOrderRepository({ prisma }),
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  }),
);

interface WorkOrderVehicleProfile {
  id: string;
  displayName: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  state: string;
  customerId: string;
}

interface WorkOrderCustomerProfile {
  id: string;
  displayName: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  state: string;
}

export const workOrderListContextQueries = {
  async findVehicles(vehicleIds: string[]): Promise<WorkOrderVehicleProfile[]> {
    if (vehicleIds.length === 0) return [];
    const records = await prisma.cartVehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: {
        id: true,
        vin: true,
        serialNumber: true,
        modelCode: true,
        modelYear: true,
        state: true,
        customerId: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      displayName: `${record.modelYear} ${record.modelCode} · ${record.serialNumber}`,
      vin: record.vin,
      serialNumber: record.serialNumber,
      modelCode: record.modelCode,
      modelYear: record.modelYear,
      state: String(record.state),
      customerId: record.customerId,
    }));
  },

  async findCustomers(customerIds: string[]): Promise<WorkOrderCustomerProfile[]> {
    if (customerIds.length === 0) return [];
    const records = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        fullName: true,
        companyName: true,
        email: true,
        phone: true,
        state: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      displayName: record.companyName?.trim() || record.fullName,
      fullName: record.fullName,
      companyName: record.companyName,
      email: record.email,
      phone: record.phone,
      state: String(record.state),
    }));
  },
};

function compactIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
}

async function loadWorkOrderListContext(items: ListWorkOrdersResponse['items']): Promise<{
  vehiclesById: Map<string, WorkOrderVehicleProfile>;
  customersById: Map<string, WorkOrderCustomerProfile>;
}> {
  const vehicles = await workOrderListContextQueries.findVehicles(
    compactIds(items.map((item) => item.vehicleId)),
  );
  const customers = await workOrderListContextQueries.findCustomers(
    compactIds(vehicles.map((vehicle) => vehicle.customerId)),
  );

  return {
    vehiclesById: new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    customersById: new Map(customers.map((customer) => [customer.id, customer])),
  };
}

function shortRef(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

export function summarizeBuildPackages(
  items: WorkOrderResponse[],
): WorkOrderBuildPackageResponse[] {
  const packagesByKey = new Map<string, WorkOrderBuildPackageResponse>();

  for (const item of items) {
    const buildConfigurationId = item.buildConfigurationId.trim();
    const bomId = item.bomId.trim();
    if (!buildConfigurationId || !bomId) continue;

    const key = `${buildConfigurationId}:${bomId}`;
    const existing = packagesByKey.get(key);
    const stateCounts = existing?.stateCounts ?? {};
    stateCounts[item.state] = (stateCounts[item.state] ?? 0) + 1;

    const lastUsedAt = item.updatedAt || item.createdAt;
    const lastVehicleDisplayName = item.vehicleProfile?.displayName;
    const lastCustomerDisplayName = item.customerProfile?.displayName;

    if (!existing) {
      packagesByKey.set(key, {
        id: key,
        buildConfigurationId,
        bomId,
        label: `Config ${shortRef(buildConfigurationId)} / BOM ${shortRef(bomId)}`,
        description: [
          `Last used on ${item.workOrderNumber}`,
          lastVehicleDisplayName,
          lastCustomerDisplayName,
        ]
          .filter(Boolean)
          .join(' · '),
        source: 'WORK_ORDER_HISTORY',
        workOrderCount: 1,
        lastUsedAt,
        lastWorkOrderId: item.id,
        lastWorkOrderNumber: item.workOrderNumber,
        lastVehicleDisplayName,
        lastCustomerDisplayName,
        stateCounts,
      });
      continue;
    }

    existing.workOrderCount += 1;
    existing.stateCounts = stateCounts;

    if (lastUsedAt >= existing.lastUsedAt) {
      existing.lastUsedAt = lastUsedAt;
      existing.lastWorkOrderId = item.id;
      existing.lastWorkOrderNumber = item.workOrderNumber;
      existing.lastVehicleDisplayName = lastVehicleDisplayName;
      existing.lastCustomerDisplayName = lastCustomerDisplayName;
      existing.description = [
        `Last used on ${item.workOrderNumber}`,
        lastVehicleDisplayName,
        lastCustomerDisplayName,
      ]
        .filter(Boolean)
        .join(' · ');
    }
  }

  return [...packagesByKey.values()].sort((left, right) =>
    right.lastUsedAt.localeCompare(left.lastUsedAt),
  );
}

function matchesBuildPackageSearch(pkg: WorkOrderBuildPackageResponse, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    pkg.label,
    pkg.description,
    pkg.buildConfigurationId,
    pkg.bomId,
    pkg.lastWorkOrderNumber,
    pkg.lastVehicleDisplayName,
    pkg.lastCustomerDisplayName,
  ].some((value) => value?.toLowerCase().includes(query));
}

export async function listBuildPackagesHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const query = toBuildPackageListQuery(event.queryStringParameters ?? {});

  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
    return json(422, {
      message: 'Build package query validation failed.',
      issues: [{ field: 'limit', message: 'limit must be a positive integer.' }],
    });
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    return json(422, {
      message: 'Build package query validation failed.',
      issues: [{ field: 'offset', message: 'offset must be a non-negative integer.' }],
    });
  }

  const limit = Math.min(query.limit ?? 100, 500);
  const offset = query.offset ?? 0;

  const items = await routes.listWorkOrders({ limit: 500, offset: 0 });
  const responseItems = items.map(toWorkOrderResponse);
  const context = await loadWorkOrderListContext(responseItems);
  const enrichedItems = responseItems.map((item) => {
    const vehicleProfile = context.vehiclesById.get(item.vehicleId) ?? null;
    const customerProfile = vehicleProfile
      ? (context.customersById.get(vehicleProfile.customerId) ?? null)
      : null;
    return {
      ...item,
      vehicleProfile,
      customerProfile,
    };
  });

  const filteredPackages = summarizeBuildPackages(enrichedItems).filter((pkg) =>
    matchesBuildPackageSearch(pkg, query.search ?? ''),
  );
  const response: ListBuildPackagesResponse = {
    items: filteredPackages.slice(offset, offset + limit),
    total: filteredPackages.length,
    limit,
    offset,
    source: 'WORK_ORDER_HISTORY',
  };

  return json(200, response);
}

export async function createWorkOrderHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const correlationId = resolveCorrelationId(event);
  const actorId = resolveActorId(event);

  const parseResult = parseJsonBody<CreateWorkOrderRequest>(event.body);
  if (!parseResult.ok) {
    return json(400, {
      message: 'Invalid JSON payload.',
      correlationId,
    });
  }

  const validation = validateCreateWorkOrderRequest(parseResult.value);
  if (!validation.ok) {
    return json(422, {
      message: 'Work order request validation failed.',
      correlationId,
      issues: validation.issues,
    });
  }

  try {
    const workOrder = await routes.createWorkOrder(parseResult.value, correlationId, actorId);
    const response: CreateWorkOrderResponse = {
      workOrder: toWorkOrderResponse(workOrder),
      event: toWorkOrderCreatedEvent(workOrder, correlationId),
    };

    return json(201, response);
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      return json(409, {
        message: error.message,
        correlationId,
      });
    }

    throw error;
  }
}

export async function listWorkOrdersHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const query = toListQuery(event.queryStringParameters ?? {});
  const validation = validateListWorkOrdersQuery(query);

  if (!validation.ok) {
    return json(422, {
      message: 'Work order query validation failed.',
      issues: validation.issues,
    });
  }

  const items = await routes.listWorkOrders(query);
  const responseItems = items.map(toWorkOrderResponse);
  const context = await loadWorkOrderListContext(responseItems);
  const enrichedItems = responseItems.map((item) => {
    const vehicleProfile = context.vehiclesById.get(item.vehicleId) ?? null;
    const customerProfile = vehicleProfile
      ? (context.customersById.get(vehicleProfile.customerId) ?? null)
      : null;
    return {
      ...item,
      vehicleProfile,
      customerProfile,
    };
  });
  const response: ListWorkOrdersResponse = {
    items: enrichedItems,
    total: items.length,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };

  if (query.includeBuildPackages) {
    response.buildPackages = summarizeBuildPackages(enrichedItems);
  }

  return json(200, response);
}

export async function transitionWorkOrderHandler(
  event: ApiGatewayProxyEventLike & { pathParameters?: { id?: string } },
): Promise<ApiGatewayProxyResultLike> {
  const correlationId = resolveCorrelationId(event);
  const actorId = resolveActorId(event);
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'Work order ID is required.', correlationId });

  const parseResult = parseJsonBody<{ state: string }>(event.body);
  if (!parseResult.ok || !parseResult.value.state) {
    return json(400, { message: 'Body must include { state }.', correlationId });
  }

  const nextState = parseResult.value.state as WorkOrderState;
  if (!Object.values(WorkOrderState).includes(nextState)) {
    return json(422, { message: `Invalid state: ${nextState}`, correlationId });
  }

  try {
    const workOrder = await routes.transitionWorkOrder(id, nextState, correlationId, actorId);
    return json(200, { workOrder: toWorkOrderResponse(workOrder) });
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      return json(409, { message: error.message, correlationId });
    }
    throw error;
  }
}

function resolveCorrelationId(event: ApiGatewayProxyEventLike): string {
  return (
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    event.requestContext?.requestId ??
    randomUUID()
  );
}

function resolveActorId(event: ApiGatewayProxyEventLike): string | undefined {
  const actorHeader = event.headers?.['x-actor-id'] ?? event.headers?.['X-Actor-Id'];
  return actorHeader?.trim() ? actorHeader.trim() : undefined;
}

function parseJsonBody<TPayload>(
  body: string | null | undefined,
): { ok: true; value: TPayload } | { ok: false } {
  if (!body?.trim()) {
    return { ok: false };
  }

  try {
    return { ok: true, value: JSON.parse(body) as TPayload };
  } catch {
    return { ok: false };
  }
}

function toListQuery(
  queryStringParameters: Record<string, string | undefined>,
): ListWorkOrdersQuery {
  const stateParam = queryStringParameters.state?.trim();
  const limitParam = queryStringParameters.limit?.trim();
  const offsetParam = queryStringParameters.offset?.trim();
  const includeBuildPackagesParam = queryStringParameters.includeBuildPackages?.trim();

  return {
    state: stateParam as WorkOrderState | undefined,
    limit: limitParam ? Number(limitParam) : undefined,
    offset: offsetParam ? Number(offsetParam) : undefined,
    includeBuildPackages:
      includeBuildPackagesParam === 'true' || includeBuildPackagesParam === '1' || undefined,
  };
}

function toBuildPackageListQuery(
  queryStringParameters: Record<string, string | undefined>,
): ListBuildPackagesQuery {
  const search = queryStringParameters.search?.trim();
  const limit = queryStringParameters.limit?.trim();
  const offset = queryStringParameters.offset?.trim();

  return {
    search: search || undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  };
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
