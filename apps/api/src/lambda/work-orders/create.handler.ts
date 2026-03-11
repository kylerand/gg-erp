import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import { createWorkOrderHandler } from './handlers.js';

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  return createWorkOrderHandler(event);
}
