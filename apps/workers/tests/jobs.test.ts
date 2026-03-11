import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorkOrderCreated } from '../src/jobs/work-order-created.job.js';
import { consoleWorkerLogger } from '../src/observability/logger.js';
import { consoleWorkerMetrics } from '../src/observability/metrics.js';

test('work_order.created job accepts valid payload', async () => {
  const result = await handleWorkOrderCreated(
    {
      id: 'event-1',
      name: 'work_order.created',
      correlationId: 'corr-1',
      emittedAt: new Date().toISOString(),
      payload: { id: 'wo-123' }
    },
    consoleWorkerLogger,
    consoleWorkerMetrics
  );

  assert.equal(result.workOrderId, 'wo-123');
  assert.equal(result.status, 'accepted');
});
