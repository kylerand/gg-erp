import { loadWorkerEnv } from './config/env.js';
import { handleWorkOrderCreated } from './jobs/work-order-created.job.js';
import { handleWorkOrderCompletedForQb } from './jobs/qb-invoice-sync.job.js';
import { handleCustomerEventForQb } from './jobs/qb-customer-sync.job.js';
import { forwardAuditLog } from './jobs/audit-log-forwarder.job.js';
import { WorkerRuntime } from './worker.js';
import { consoleWorkerLogger } from './observability/logger.js';
import { consoleWorkerMetrics } from './observability/metrics.js';

export function createWorkerRuntime(): WorkerRuntime {
  const env = loadWorkerEnv();
  const runtime = new WorkerRuntime({
    maxRetries: env.maxRetries,
    logger: consoleWorkerLogger,
    metrics: consoleWorkerMetrics
  });

  runtime.register('work_order.created', async (event) => {
    await handleWorkOrderCreated(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  runtime.register('work_order.completed', async (event) => {
    await handleWorkOrderCompletedForQb(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  runtime.register('customer.created', async (event) => {
    await handleCustomerEventForQb(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  runtime.register('customer.updated', async (event) => {
    await handleCustomerEventForQb(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  runtime.register('audit.event.recorded', async (event) => {
    await forwardAuditLog(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  return runtime;
}

export const defaultWorkerRuntime = createWorkerRuntime();
