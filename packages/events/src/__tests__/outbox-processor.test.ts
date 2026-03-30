import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { EventBus } from '../event-bus.js';
import type { EventEnvelope } from '../event-types.js';
import { processOutbox, type OutboxProcessorOptions } from '../outbox-processor.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MockOutboxRow {
  id: string;
  eventName: string;
  correlationId: string;
  payload: unknown;
  state: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

function buildRow(overrides: Partial<MockOutboxRow> = {}): MockOutboxRow {
  return {
    id: 'row-1',
    eventName: 'work_order.completed',
    correlationId: 'corr-1',
    payload: { workOrderId: 'wo-42' },
    state: 'PENDING',
    attemptCount: 0,
    lastError: null,
    createdAt: new Date('2025-01-15T00:00:00.000Z'),
    publishedAt: null,
    ...overrides,
  };
}

function buildMockBus(publishImpl?: (event: EventEnvelope) => Promise<void>): EventBus {
  const defaultPublish = async () => {};
  return {
    register: mock.fn(),
    publish: mock.fn(publishImpl ?? defaultPublish),
  };
}

interface UpdateCall {
  where: { id: string };
  data: { state: string; publishedAt?: Date; lastError?: string; attemptCount: number };
}

function buildMockPrisma(rows: MockOutboxRow[]) {
  const updateCalls: UpdateCall[] = [];

  const prisma = {
    eventOutbox: {
      findMany: mock.fn(async () => rows),
      update: mock.fn(async (args: UpdateCall) => {
        updateCalls.push(args);
        return {};
      }),
    },
  } as unknown as OutboxProcessorOptions['prisma'];

  return { prisma, updateCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('processOutbox — publishes pending records and marks PUBLISHED', async () => {
  const row = buildRow();
  const bus = buildMockBus();
  const { prisma, updateCalls } = buildMockPrisma([row]);

  const result = await processOutbox(bus, { prisma });

  assert.equal(result.processed, 1);
  assert.equal(result.published, 1);
  assert.equal(result.failed, 0);

  // Verify bus.publish was called with the correct envelope
  const publishFn = bus.publish as unknown as ReturnType<typeof mock.fn>;
  assert.equal(publishFn.mock.calls.length, 1);

  const envelope = publishFn.mock.calls[0]?.arguments[0] as EventEnvelope;
  assert.equal(envelope.id, 'row-1');
  assert.equal(envelope.name, 'work_order.completed');
  assert.equal(envelope.correlationId, 'corr-1');

  // Verify DB update
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.state, 'PUBLISHED');
  assert.equal(updateCalls[0]?.data.attemptCount, 1);
  assert.ok(updateCalls[0]?.data.publishedAt instanceof Date);
});

test('processOutbox — marks as FAILED on publish error', async () => {
  const row = buildRow();
  const bus = buildMockBus(async () => {
    throw new Error('EventBridge timeout');
  });
  const { prisma, updateCalls } = buildMockPrisma([row]);

  const result = await processOutbox(bus, { prisma });

  assert.equal(result.processed, 1);
  assert.equal(result.published, 0);
  assert.equal(result.failed, 1);

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.state, 'FAILED');
  assert.equal(updateCalls[0]?.data.lastError, 'EventBridge timeout');
  assert.equal(updateCalls[0]?.data.attemptCount, 1);
});

test('processOutbox — respects batch size limit', async () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    buildRow({ id: `row-${i}`, correlationId: `corr-${i}` }),
  );
  const bus = buildMockBus();
  const { prisma } = buildMockPrisma(rows);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const findManyMock = prisma!.eventOutbox.findMany as unknown as ReturnType<typeof mock.fn>;

  await processOutbox(bus, { prisma, batchSize: 3 });

  const findManyArgs = findManyMock.mock.calls[0]?.arguments[0] as {
    take: number;
  };
  assert.equal(findManyArgs.take, 3);
});

test('processOutbox — returns zero counts for empty outbox', async () => {
  const bus = buildMockBus();
  const { prisma } = buildMockPrisma([]);

  const result = await processOutbox(bus, { prisma });

  assert.equal(result.processed, 0);
  assert.equal(result.published, 0);
  assert.equal(result.failed, 0);

  // bus.publish should not have been called
  const publishFn = bus.publish as unknown as ReturnType<typeof mock.fn>;
  assert.equal(publishFn.mock.calls.length, 0);
});

test('processOutbox — processes mixed success and failure', async () => {
  const rows = [
    buildRow({ id: 'ok-1', correlationId: 'c1' }),
    buildRow({ id: 'fail-1', correlationId: 'c2' }),
    buildRow({ id: 'ok-2', correlationId: 'c3' }),
  ];

  let callIndex = 0;
  const bus = buildMockBus(async () => {
    callIndex += 1;
    if (callIndex === 2) {
      throw new Error('transient failure');
    }
  });
  const { prisma, updateCalls } = buildMockPrisma(rows);

  const result = await processOutbox(bus, { prisma });

  assert.equal(result.processed, 3);
  assert.equal(result.published, 2);
  assert.equal(result.failed, 1);

  const states = updateCalls.map((c: UpdateCall) => c.data.state);
  assert.deepEqual(states, ['PUBLISHED', 'FAILED', 'PUBLISHED']);
});
