import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { EventEnvelope } from '../event-types.js';
import { EventBridgeEventBus } from '../eventbridge-bus.js';

function buildEnvelope(): EventEnvelope<{ orderId: string }> {
  return {
    id: 'evt-001',
    name: 'work_order.created',
    correlationId: 'corr-123',
    emittedAt: '2025-01-15T00:00:00.000Z',
    payload: { orderId: 'wo-42' },
  };
}

// Stub the EventBridge client with a mock send method
type MockClient = NonNullable<ConstructorParameters<typeof EventBridgeEventBus>[0]>;

function buildMockClient(sendImpl?: (command: unknown) => Promise<unknown>) {
  const defaultSend = async () => ({ FailedEntryCount: 0, Entries: [{ EventId: 'abc' }] });
  const sendFn = mock.fn(sendImpl ?? defaultSend);
  return { send: sendFn, sendFn } as unknown as MockClient & { sendFn: typeof sendFn };
}

test('EventBridgeEventBus — throws when EVENT_BUS_NAME is not set', () => {
  const original = process.env.EVENT_BUS_NAME;
  delete process.env.EVENT_BUS_NAME;
  try {
    assert.throws(
      () => new EventBridgeEventBus(buildMockClient()),
      /EVENT_BUS_NAME environment variable is required/,
    );
  } finally {
    if (original !== undefined) process.env.EVENT_BUS_NAME = original;
  }
});

test('EventBridgeEventBus — publish calls putEvents with correct params', async () => {
  process.env.EVENT_BUS_NAME = 'test-bus';
  const client = buildMockClient();
  const bus = new EventBridgeEventBus(client);
  const envelope = buildEnvelope();

  await bus.publish(envelope);

  const calls = client.sendFn.mock.calls;
  assert.equal(calls.length, 1);

  const command = calls[0]?.arguments[0] as { input: { Entries: Record<string, unknown>[] } };
  const entry = command.input.Entries[0];

  assert.equal(entry.Source, 'gg-erp');
  assert.equal(entry.DetailType, 'work_order.created');
  assert.equal(entry.EventBusName, 'test-bus');

  const detail = JSON.parse(entry.Detail as string) as EventEnvelope<{ orderId: string }>;
  assert.equal(detail.name, 'work_order.created');
  assert.equal(detail.correlationId, 'corr-123');
  assert.deepEqual(detail.payload, { orderId: 'wo-42' });

  delete process.env.EVENT_BUS_NAME;
});

test('EventBridgeEventBus — throws on FailedEntryCount > 0', async () => {
  process.env.EVENT_BUS_NAME = 'test-bus';
  const client = buildMockClient(async () => ({
    FailedEntryCount: 1,
    Entries: [{ ErrorCode: 'InternalError', ErrorMessage: 'Something broke' }],
  }));
  const bus = new EventBridgeEventBus(client);

  await assert.rejects(
    () => bus.publish(buildEnvelope()),
    /EventBridge put failed: InternalError — Something broke/,
  );

  delete process.env.EVENT_BUS_NAME;
});

test('EventBridgeEventBus — wraps SDK transport errors', async () => {
  process.env.EVENT_BUS_NAME = 'test-bus';
  const client = buildMockClient(async () => {
    throw new Error('Network timeout');
  });
  const bus = new EventBridgeEventBus(client);

  await assert.rejects(
    () => bus.publish(buildEnvelope()),
    /Failed to publish event work_order\.created: Network timeout/,
  );

  delete process.env.EVENT_BUS_NAME;
});

test('EventBridgeEventBus — notifies local subscribers after successful publish', async () => {
  process.env.EVENT_BUS_NAME = 'test-bus';
  const client = buildMockClient();
  const bus = new EventBridgeEventBus(client);

  const received: EventEnvelope<{ orderId: string }>[] = [];
  bus.register('work_order.created', async (evt: EventEnvelope<{ orderId: string }>) => {
    received.push(evt);
  });

  await bus.publish(buildEnvelope());

  assert.equal(received.length, 1);
  assert.equal(received[0]?.payload.orderId, 'wo-42');

  delete process.env.EVENT_BUS_NAME;
});

test('EventBridgeEventBus — does not notify subscribers on publish failure', async () => {
  process.env.EVENT_BUS_NAME = 'test-bus';
  const client = buildMockClient(async () => {
    throw new Error('boom');
  });
  const bus = new EventBridgeEventBus(client);

  const received: EventEnvelope<unknown>[] = [];
  bus.register('work_order.created', async (evt: EventEnvelope<unknown>) => {
    received.push(evt);
  });

  await assert.rejects(() => bus.publish(buildEnvelope()));

  assert.equal(received.length, 0);

  delete process.env.EVENT_BUS_NAME;
});
