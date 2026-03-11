import type { RequestContext } from './request-context.js';

export interface AuditContext {
  actorId?: string;
  correlationId: string;
  source: string;
}

export function createAuditContext(requestContext: RequestContext, source: string): AuditContext {
  return {
    actorId: requestContext.actorId,
    correlationId: requestContext.correlationId,
    source
  };
}
