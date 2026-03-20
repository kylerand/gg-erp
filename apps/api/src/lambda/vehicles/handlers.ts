import { randomUUID } from 'node:crypto';
import { InvariantViolationError } from '../../../../../packages/domain/src/model/index.js';
import { InMemoryAuditSink } from '../../audit/index.js';
import { createVehicleRoutes } from '../../contexts/build-planning/vehicle.routes.js';
import {
  toVehicleResponse,
  type RegisterVehicleRequest,
} from '../../contexts/build-planning/vehicle.contracts.js';
import { PrismaVehicleRepository } from '../../contexts/build-planning/vehicle.prisma.repository.js';
import { VehicleService } from '../../contexts/build-planning/vehicle.service.js';
import { validateRegisterVehicleRequest } from '../../contexts/build-planning/vehicle.validation.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../../events/index.js';
import { ConsoleObservabilityHooks } from '../../observability/index.js';

export interface ApiGatewayProxyEventLike {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    requestId?: string;
  };
}

export interface ApiGatewayProxyResultLike {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const repository = new PrismaVehicleRepository();

const routes = createVehicleRoutes(
  new VehicleService({
    repository,
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  }),
  repository,
);

export async function registerVehicleHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const correlationId = resolveCorrelationId(event);
  const actorId = resolveActorId(event);

  const parseResult = parseJsonBody<RegisterVehicleRequest>(event.body);
  if (!parseResult.ok) {
    return json(400, { message: 'Invalid JSON payload.', correlationId });
  }

  const validation = validateRegisterVehicleRequest(parseResult.value);
  if (!validation.ok) {
    return json(422, { message: 'Validation failed.', issues: validation.issues, correlationId });
  }

  try {
    const vehicle = await routes.registerVehicle(parseResult.value, correlationId, actorId);
    return json(201, { vehicle: toVehicleResponse(vehicle) });
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      return json(409, { message: error.message, correlationId });
    }
    throw error;
  }
}

export async function getVehicleHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const correlationId = resolveCorrelationId(event);
  const id = event.pathParameters?.id;

  if (!id) {
    return json(400, { message: 'Vehicle ID is required.', correlationId });
  }

  const vehicle = await routes.findVehicleById(id);
  if (!vehicle) {
    return json(404, { message: `Vehicle '${id}' not found.`, correlationId });
  }

  return json(200, { vehicle: toVehicleResponse(vehicle) });
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

function json(statusCode: number, payload: unknown): ApiGatewayProxyResultLike {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
