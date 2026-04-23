import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import { toWorkOrderResponse } from '../../contexts/build-planning/workOrder.contracts.js';
import { PrismaWorkOrderRepository } from '../../contexts/build-planning/workOrder.prisma.repository.js';

const repository = new PrismaWorkOrderRepository();

function json(statusCode: number, body: unknown): ApiGatewayProxyResultLike {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'Work order ID is required.' });

  // Prisma rejects non-UUID strings at the driver layer with a 500; treat a
  // malformed id as a clean 404.
  if (!UUID_RE.test(id)) {
    return json(404, { message: `Work order not found: ${id}` });
  }

  const workOrder = await repository.findWorkOrderById(id);
  if (!workOrder) {
    return json(404, { message: `Work order not found: ${id}` });
  }

  return json(200, { workOrder: toWorkOrderResponse(workOrder) });
}
