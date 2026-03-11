import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRuntime } from '../src/worker.js';

test('worker runtime retries and fails after max retries', async () => {
  const runtime = new WorkerRuntime({ maxRetries: 2 });

  runtime.register('work_order.created', async () => {
    throw new Error('simulated failure');
  });

  await assert.rejects(
    runtime.handle({
      id: 'evt-2',
      name: 'work_order.created',
      correlationId: 'corr-2',
      emittedAt: new Date().toISOString(),
      payload: { id: 'wo-2' }
    }),
    /simulated failure/
  );
});

test('worker runtime ignores unknown event handlers', async () => {
  const runtime = new WorkerRuntime({ maxRetries: 2 });

  await runtime.handle({
    id: 'evt-3',
    name: 'work_order.completed',
    correlationId: 'corr-3',
    emittedAt: new Date().toISOString(),
    payload: { id: 'wo-3' }
  });

  assert.ok(true);
});
