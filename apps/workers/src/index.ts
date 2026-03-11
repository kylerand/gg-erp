import { loadWorkerEnv } from './config/env.js';
import { handleWorkOrderCreated } from './jobs/work-order-created.job.js';
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

  runtime.register('audit.event.recorded', async (event) => {
    await forwardAuditLog(event, consoleWorkerLogger, consoleWorkerMetrics);
  });

  return runtime;
}

export const defaultWorkerRuntime = createWorkerRuntime();
