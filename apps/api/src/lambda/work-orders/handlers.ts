import { randomUUID } from 'node:crypto';
import { InvariantViolationError, WorkOrderState } from '../../../../../packages/domain/src/model/index.js';
import { InMemoryAuditSink } from '../../audit/index.js';
import { createWorkOrderRoutes } from '../../contexts/build-planning/workOrder.routes.js';
import {
  toWorkOrderCreatedEvent,
  toWorkOrderResponse,
  type CreateWorkOrderRequest,
  type CreateWorkOrderResponse,
  type ListWorkOrdersQuery,
  type ListWorkOrdersResponse,
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

const routes = createWorkOrderRoutes(
  new WorkOrderService({
    repository: new PrismaWorkOrderRepository(),
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  }),
);

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
  const response: ListWorkOrdersResponse = {
    items: items.map(toWorkOrderResponse),
    total: items.length,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };
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

  return {
    state: stateParam as WorkOrderState | undefined,
    limit: limitParam ? Number(limitParam) : undefined,
    offset: offsetParam ? Number(offsetParam) : undefined,
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
