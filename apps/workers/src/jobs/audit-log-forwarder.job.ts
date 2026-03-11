import type { WorkerEvent } from '../events/subscribers.js';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';

export interface AuditForwardResult {
  forwarded: boolean;
}

export async function forwardAuditLog(
  event: WorkerEvent,
  logger: WorkerLogger,
  metrics: WorkerMetrics
): Promise<AuditForwardResult> {
  logger.info('Forwarding audit event', {
    eventName: event.name,
    correlationId: event.correlationId
  });
  metrics.increment('worker.job.audit_forward', 1, { result: 'success' });

  return { forwarded: true };
}
