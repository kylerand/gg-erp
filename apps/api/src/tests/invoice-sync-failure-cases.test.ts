import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { type EventEnvelope, InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  InvoiceSyncService,
  type InvoiceSyncQueries,
} from '../contexts/accounting/invoiceSync.service.js';
import {
  InvoiceSyncState,
  type InvoiceSyncRecord,
} from '../../../../packages/domain/src/model/accounting.js';

function createMockInvoiceSyncQueries(): InvoiceSyncQueries {
  const records = new Map<string, InvoiceSyncRecord>();
  return {
    async findById(id: string) {
      const r = records.get(id);
      return r ? { ...r } : undefined;
    },
    async findByInvoiceNumber(invoiceNumber: string) {
      const r = [...records.values()].find((rec) => rec.invoiceNumber === invoiceNumber);
      return r ? { ...r } : undefined;
    },
    async save(record: InvoiceSyncRecord, _correlationId: string) {
      records.set(record.id, { ...record });
    },
  };
}

test('invoice sync enforces transition rules and supports retry from FAILED', async () => {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const service = new InvoiceSyncService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    queries: createMockInvoiceSyncQueries(),
  });

  const context = {
    correlationId: 'inv-sync-1',
    actorId: 'accounting-user',
    module: 'test'
  };

  const record = await service.createRecord(
    {
      invoiceNumber: 'INV-1001',
      workOrderId: 'wo-1',
      provider: 'QUICKBOOKS'
    },
    context
  );

  const started = await service.startSync(record.id, context);
  assert.equal(started.state, InvoiceSyncState.IN_PROGRESS);
  assert.equal(started.attemptCount, 1);

  const failed = await service.markFailure(record.id, 'QB_TIMEOUT', 'QuickBooks timeout', context);
  assert.equal(failed.state, InvoiceSyncState.FAILED);

  await assert.rejects(
    service.markSuccess(record.id, 'qb-123', context),
    /Transition FAILED -> SYNCED is not allowed/
  );

  const retried = await service.startSync(record.id, context);
  assert.equal(retried.state, InvoiceSyncState.IN_PROGRESS);
  assert.equal(retried.attemptCount, 2);

  const retriedEvent = publisher.published.find((event) => event.name === 'invoice_sync.retried');
  assert.ok(retriedEvent, 'Expected invoice_sync.retried event when retrying FAILED record');

  const outboxRecords = outbox.list();
  assert.ok(outboxRecords.length > 0, 'Expected outbox records for invoice sync transitions');
  for (const outboxRecord of outboxRecords) {
    assert.equal(outboxRecord.state, 'PUBLISHED');
    assert.ok(outboxRecord.publishedAt, 'Published outbox record should have publishedAt timestamp');
  }

  const auditEmissions = audit.listEmissions();
  assert.equal(auditEmissions.length, audit.list().length);
  assert.ok(
    auditEmissions.every((emission) => emission.eventName === 'audit.event.recorded'),
    'Expected audit emissions to be explicit and observable'
  );
});

test('invoice sync marks outbox record as FAILED when publish throws', async () => {
  const outbox = new InMemoryOutbox();
  const service = new InvoiceSyncService({
    audit: new InMemoryAuditSink(),
    publisher: {
      async publish<TPayload>(_event: EventEnvelope<TPayload>): Promise<void> {
        throw new Error('event publish failed');
      }
    },
    outbox,
    observability: ConsoleObservabilityHooks,
    queries: createMockInvoiceSyncQueries(),
  });

  await assert.rejects(
    service.createRecord(
      {
        invoiceNumber: 'INV-2001',
        workOrderId: 'wo-2',
        provider: 'QUICKBOOKS'
      },
      {
        correlationId: 'inv-sync-fail-1',
        actorId: 'accounting-user',
        module: 'test'
      }
    ),
    /event publish failed/
  );

  const [failedRecord] = outbox.list();
  assert.ok(failedRecord, 'Expected outbox record to be persisted before publish');
  assert.equal(failedRecord.state, 'FAILED');
  assert.equal(failedRecord.failureReason, 'event publish failed');
  assert.ok(failedRecord.failedAt, 'Failed outbox record should track failedAt timestamp');
});
