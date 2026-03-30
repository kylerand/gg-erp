import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  PaymentSyncService,
  type PaymentSyncQueries,
  type PaymentSyncResolvers,
} from '../contexts/accounting/paymentSync.service.js';
import {
  verifyWebhookSignature,
  extractPaymentEntities,
} from '../lambda/accounting/webhook.handler.js';
import {
  PaymentSyncState,
  type PaymentSyncRecord,
} from '../../../../packages/domain/src/model/accounting.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function createMockPaymentSyncQueries(): PaymentSyncQueries {
  const records = new Map<string, PaymentSyncRecord>();
  return {
    async findById(id: string) {
      const r = records.get(id);
      return r ? { ...r } : undefined;
    },
    async findByQbPaymentId(qbPaymentId: string) {
      const r = [...records.values()].find(
        (rec) => rec.qbPaymentId === qbPaymentId,
      );
      return r ? { ...r } : undefined;
    },
    async listByState(state: PaymentSyncState, _limit?: number) {
      return [...records.values()]
        .filter((r) => r.state === state)
        .map((r) => ({ ...r }));
    },
    async save(record: PaymentSyncRecord) {
      records.set(record.id, { ...record });
    },
  };
}

function createMockResolvers(
  overrides?: Partial<PaymentSyncResolvers>,
): PaymentSyncResolvers {
  return {
    async findInvoiceSyncByQbInvoiceId(qbInvoiceId: string) {
      return {
        invoiceSyncId: `inv-sync-${qbInvoiceId}`,
        workOrderId: 'wo-001',
      };
    },
    async findCustomerByWorkOrder(_workOrderId: string) {
      return 'cust-001';
    },
    ...overrides,
  };
}

function createService(overrides?: {
  queries?: PaymentSyncQueries;
  resolvers?: PaymentSyncResolvers;
  publisher?: InMemoryEventPublisher;
  audit?: InMemoryAuditSink;
  outbox?: InMemoryOutbox;
}) {
  const audit = overrides?.audit ?? new InMemoryAuditSink();
  const publisher = overrides?.publisher ?? new InMemoryEventPublisher();
  const outbox = overrides?.outbox ?? new InMemoryOutbox();
  const queries = overrides?.queries ?? createMockPaymentSyncQueries();
  const resolvers = overrides?.resolvers ?? createMockResolvers();

  const service = new PaymentSyncService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    queries,
    resolvers,
  });

  return { service, audit, publisher, outbox, queries };
}

const context = {
  correlationId: 'pay-sync-1',
  actorId: 'system',
  module: 'test',
};

// ─── createFromWebhook ──────────────────────────────────────────────────────

test('createFromWebhook creates PENDING record', async () => {
  const { service, publisher } = createService();

  const record = await service.createFromWebhook(
    {
      qbPaymentId: 'qb-pay-001',
      qbInvoiceId: 'qb-inv-001',
      amountCents: 15000,
      paymentMethod: 'CreditCard',
      paymentDate: '2024-03-15',
    },
    context,
  );

  assert.equal(record.state, PaymentSyncState.PENDING);
  assert.equal(record.qbPaymentId, 'qb-pay-001');
  assert.equal(record.qbInvoiceId, 'qb-inv-001');
  assert.equal(record.amountCents, 15000);
  assert.equal(record.paymentMethod, 'CreditCard');
  assert.equal(record.paymentDate, '2024-03-15');
  assert.equal(record.direction, 'INBOUND');
  assert.equal(record.attemptCount, 0);
  assert.equal(record.workOrderId, 'wo-001');
  assert.equal(record.customerId, 'cust-001');

  const startedEvent = publisher.published.find(
    (e) => e.name === 'payment_sync.started',
  );
  assert.ok(startedEvent, 'Expected payment_sync.started event');
});

test('createFromWebhook returns existing record for duplicate qbPaymentId', async () => {
  const { service } = createService();

  const first = await service.createFromWebhook(
    { qbPaymentId: 'qb-pay-dup', qbInvoiceId: 'qb-inv-dup', amountCents: 1000 },
    context,
  );
  const second = await service.createFromWebhook(
    { qbPaymentId: 'qb-pay-dup', qbInvoiceId: 'qb-inv-dup', amountCents: 1000 },
    context,
  );

  assert.equal(first.id, second.id, 'Should return same record for duplicate');
});

// ─── processPayment ─────────────────────────────────────────────────────────

test('processPayment lifecycle PENDING → IN_PROGRESS → SYNCED', async () => {
  const { service, publisher } = createService();

  const record = await service.createFromWebhook(
    {
      qbPaymentId: 'qb-pay-002',
      qbInvoiceId: 'qb-inv-002',
      amountCents: 25000,
    },
    context,
  );

  const processed = await service.processPayment(record.id, context);

  assert.equal(processed.state, PaymentSyncState.SYNCED);
  assert.equal(processed.attemptCount, 1);
  assert.ok(processed.lastAttemptAt, 'Expected lastAttemptAt to be set');

  const completedEvent = publisher.published.find(
    (e) => e.name === 'payment_sync.completed',
  );
  assert.ok(completedEvent, 'Expected payment_sync.completed event');
});

test('processPayment failure transitions to FAILED with error message and increments attemptCount', async () => {
  const queries = createMockPaymentSyncQueries();

  // Pre-populate a PENDING record directly
  const now = new Date().toISOString();
  const pendingRecord: PaymentSyncRecord = {
    id: 'pay-fail-001',
    invoiceSyncId: 'inv-sync-1',
    workOrderId: 'wo-001',
    customerId: 'cust-001',
    qbPaymentId: 'qb-pay-fail',
    qbInvoiceId: 'qb-inv-fail',
    amountCents: 5000,
    state: PaymentSyncState.PENDING,
    direction: 'INBOUND',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await queries.save(pendingRecord);

  // Resolvers that fail during processPayment
  const resolvers = createMockResolvers({
    async findCustomerByWorkOrder() {
      return undefined; // Simulate customer not found
    },
  });

  const publisher = new InMemoryEventPublisher();
  const { service } = createService({ queries, resolvers, publisher });

  const processed = await service.processPayment('pay-fail-001', context);

  assert.equal(processed.state, PaymentSyncState.FAILED);
  assert.equal(processed.attemptCount, 1);
  assert.ok(processed.errorMessage, 'Expected errorMessage to be set');
  assert.ok(
    processed.errorMessage.includes('Customer not found'),
    `Expected error about customer, got: ${processed.errorMessage}`,
  );

  const failedEvent = publisher.published.find(
    (e) => e.name === 'payment_sync.failed',
  );
  assert.ok(failedEvent, 'Expected payment_sync.failed event');
});

// ─── retryPayment ───────────────────────────────────────────────────────────

test('retryPayment transitions from FAILED to IN_PROGRESS', async () => {
  const queries = createMockPaymentSyncQueries();

  // Pre-populate a FAILED record
  const now = new Date().toISOString();
  const failedRecord: PaymentSyncRecord = {
    id: 'pay-retry-001',
    invoiceSyncId: 'inv-sync-1',
    workOrderId: 'wo-001',
    customerId: 'cust-001',
    qbPaymentId: 'qb-pay-retry',
    qbInvoiceId: 'qb-inv-retry',
    amountCents: 7500,
    state: PaymentSyncState.FAILED,
    direction: 'INBOUND',
    errorMessage: 'Previous failure',
    attemptCount: 1,
    lastAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await queries.save(failedRecord);

  const { service } = createService({ queries });

  const retried = await service.retryPayment('pay-retry-001', context);

  assert.equal(retried.state, PaymentSyncState.IN_PROGRESS);
  assert.equal(retried.attemptCount, 2);
  assert.equal(retried.errorMessage, undefined, 'Error should be cleared on retry');
});

test('retryPayment rejects from non-FAILED state', async () => {
  const { service } = createService();

  const record = await service.createFromWebhook(
    {
      qbPaymentId: 'qb-pay-no-retry',
      qbInvoiceId: 'qb-inv-no-retry',
      amountCents: 3000,
    },
    context,
  );

  // Record is PENDING — retryPayment should reject
  await assert.rejects(
    service.retryPayment(record.id, context),
    /must be FAILED/,
  );
});

// ─── Webhook handler: signature validation ──────────────────────────────────

test('webhook signature validation accepts valid signature', () => {
  const token = 'test-verifier-token';
  const payload = '{"eventNotifications":[]}';
  const signature = createHmac('sha256', token)
    .update(payload)
    .digest('base64');

  assert.ok(
    verifyWebhookSignature(payload, signature, token),
    'Expected valid signature to be accepted',
  );
});

test('webhook signature validation rejects invalid signature', () => {
  const token = 'test-verifier-token';
  const payload = '{"eventNotifications":[]}';
  const wrongSignature = 'invalid-base64-signature';

  assert.ok(
    !verifyWebhookSignature(payload, wrongSignature, token),
    'Expected invalid signature to be rejected',
  );
});

test('webhook signature validation rejects tampered payload', () => {
  const token = 'test-verifier-token';
  const payload = '{"eventNotifications":[]}';
  const signature = createHmac('sha256', token)
    .update(payload)
    .digest('base64');

  const tamperedPayload = '{"eventNotifications":[{"tampered":true}]}';
  assert.ok(
    !verifyWebhookSignature(tamperedPayload, signature, token),
    'Expected tampered payload to be rejected',
  );
});

// ─── Webhook handler: entity extraction ─────────────────────────────────────

test('webhook handler extracts Payment entities correctly', () => {
  const notifications = [
    {
      realmId: 'realm-1',
      dataChangeEvent: {
        entities: [
          {
            name: 'Payment',
            id: '100',
            operation: 'Create' as const,
            lastUpdated: '2024-03-15T10:00:00Z',
          },
          {
            name: 'Invoice',
            id: '200',
            operation: 'Update' as const,
            lastUpdated: '2024-03-15T10:00:00Z',
          },
          {
            name: 'Payment',
            id: '101',
            operation: 'Update' as const,
            lastUpdated: '2024-03-15T10:01:00Z',
          },
        ],
      },
    },
  ];

  const result = extractPaymentEntities(notifications);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, '100');
  assert.equal(result[0].operation, 'Create');
  assert.equal(result[1].id, '101');
  assert.equal(result[1].operation, 'Update');
});

test('webhook handler ignores non-Payment entities', () => {
  const notifications = [
    {
      realmId: 'realm-1',
      dataChangeEvent: {
        entities: [
          {
            name: 'Invoice',
            id: '200',
            operation: 'Create' as const,
            lastUpdated: '2024-03-15T10:00:00Z',
          },
          {
            name: 'Customer',
            id: '300',
            operation: 'Update' as const,
            lastUpdated: '2024-03-15T10:00:00Z',
          },
          {
            name: 'Payment',
            id: '100',
            operation: 'Delete' as const,
            lastUpdated: '2024-03-15T10:00:00Z',
          },
        ],
      },
    },
  ];

  const result = extractPaymentEntities(notifications);

  assert.equal(result.length, 0, 'Should not extract non-Payment or Delete operations');
});

test('webhook handler handles multiple notifications with Payment entities', () => {
  const notifications = [
    {
      realmId: 'realm-1',
      dataChangeEvent: {
        entities: [
          { name: 'Payment', id: '100', operation: 'Create' as const, lastUpdated: '2024-03-15T10:00:00Z' },
        ],
      },
    },
    {
      realmId: 'realm-2',
      dataChangeEvent: {
        entities: [
          { name: 'Payment', id: '200', operation: 'Update' as const, lastUpdated: '2024-03-15T10:01:00Z' },
          { name: 'Invoice', id: '300', operation: 'Create' as const, lastUpdated: '2024-03-15T10:02:00Z' },
        ],
      },
    },
  ];

  const result = extractPaymentEntities(notifications);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, '100');
  assert.equal(result[1].id, '200');
});

// ─── Worker: batch processing ───────────────────────────────────────────────

test('worker processes batch of pending records', async () => {
  const queries = createMockPaymentSyncQueries();
  const { service } = createService({ queries });

  // Create multiple PENDING records
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const record = await service.createFromWebhook(
      {
        qbPaymentId: `qb-pay-batch-${i}`,
        qbInvoiceId: `qb-inv-batch-${i}`,
        amountCents: (i + 1) * 1000,
      },
      context,
    );
    ids.push(record.id);
  }

  // Simulate worker: list PENDING and process each
  const pending = await service.listByState(PaymentSyncState.PENDING);
  assert.equal(pending.length, 3);

  const results: PaymentSyncRecord[] = [];
  for (const record of pending) {
    const result = await service.processPayment(record.id, context);
    results.push(result);
  }

  assert.equal(results.length, 3);
  assert.ok(
    results.every((r) => r.state === PaymentSyncState.SYNCED),
    'All records should be SYNCED after processing',
  );

  // Verify no more PENDING records
  const remainingPending = await service.listByState(PaymentSyncState.PENDING);
  assert.equal(remainingPending.length, 0, 'No PENDING records should remain');
});
