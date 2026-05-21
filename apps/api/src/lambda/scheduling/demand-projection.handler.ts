import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import { getBuildSlotDemandProjectionHandler } from './handlers.js';

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  return getBuildSlotDemandProjectionHandler(event);
}
