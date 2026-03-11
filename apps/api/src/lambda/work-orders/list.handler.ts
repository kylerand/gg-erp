import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import { listWorkOrdersHandler } from './handlers.js';

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  return listWorkOrdersHandler(event);
}
