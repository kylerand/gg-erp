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

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'Work order ID is required.' });

  const workOrder = await repository.findWorkOrderById(id);
  if (!workOrder) {
    return json(404, { message: `Work order not found: ${id}` });
  }

  return json(200, { workOrder: toWorkOrderResponse(workOrder) });
}
