import type { ApiGatewayProxyEventLike, ApiGatewayProxyResultLike } from './handlers.js';
import { listBuildPackagesHandler } from './handlers.js';

export async function handler(event: ApiGatewayProxyEventLike): Promise<ApiGatewayProxyResultLike> {
  return listBuildPackagesHandler(event);
}
