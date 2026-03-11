import type { WorkerEvent } from '../events/subscribers.js';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';

export interface WorkOrderCreatedResult {
  workOrderId: string;
  status: 'accepted';
}

export async function handleWorkOrderCreated(
  event: WorkerEvent,
  logger: WorkerLogger,
  metrics: WorkerMetrics
): Promise<WorkOrderCreatedResult> {
  const payload = event.payload as { id?: string };
  if (!payload?.id) {
    throw new Error('work_order.created payload must include id');
  }

  logger.info('Processing work_order.created event', {
    correlationId: event.correlationId,
    workOrderId: payload.id
  });
  metrics.increment('worker.job.work_order_created', 1, { result: 'success' });

  return {
    workOrderId: payload.id,
    status: 'accepted'
  };
}
