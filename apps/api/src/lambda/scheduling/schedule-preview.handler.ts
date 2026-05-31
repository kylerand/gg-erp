import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import { getSchedulePreviewHandler } from './handlers.js';

export async function handler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  return getSchedulePreviewHandler(event);
}
