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
import { InvoiceSyncProcessor } from '../contexts/accounting/invoiceSyncProcessor.service.js';
import type { MappingService } from '../contexts/accounting/mapping.service.js';

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

// ─── InvoiceSyncProcessor preflight tests ────────────────────────────────────

function makeFakePrisma(recordState = 'PENDING') {
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    invoiceSyncRecord: {
      async findUnique(_args: unknown) {
        return {
          id: 'rec-1',
          invoiceNumber: 'INV-001',
          workOrderId: 'wo-1',
          state: recordState,
        };
      },
      async update(args: { where: unknown; data: Record<string, unknown> }) {
        updates.push(args.data);
        return { ...args.data };
      },
    },
    // Not reached when mapping preflight fails
    woOrder: {
      async findUnique(_args: unknown) {
        return null;
      },
    },
    woPartLine: {
      async findMany(_args: unknown) {
        return [];
      },
    },
  };

  return { prisma: prisma as unknown as import('@prisma/client').PrismaClient, updates };
}

function makeMappingService(error: string | null): MappingService {
  return {
    async validateInvoiceMappings(_accountId: string) { return error; },
    async upsertDimensionMapping() { throw new Error('not used'); },
    async listDimensionMappings() { return []; },
    async upsertTaxMapping() { throw new Error('not used'); },
    async listTaxMappings() { return []; },
  } as unknown as MappingService;
}

function makeEntityMapping() {
  return {
    async findExternalId() { return null; },
    async findEntityId() { return null; },
    async upsertMapping() { throw new Error('not used'); },
    async deactivateMapping() {},
    async listMappings() { return { items: [], total: 0 }; },
  } as unknown as import('../contexts/accounting/entityMapping.service.js').EntityMappingService;
}

test('processor transitions record to FAILED when required mappings are missing', async () => {
  const { prisma, updates } = makeFakePrisma();
  const processor = new InvoiceSyncProcessor({
    prisma,
    entityMapping: makeEntityMapping(),
    mapping: makeMappingService(
      'MAPPING_MISSING: no active INCOME_ACCOUNT dimension mapping for account acct-1',
    ),
  });

  const result = await processor.processRecord('rec-1', 'acct-1', {} as never);

  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'MAPPING_MISSING');
  assert.match(result.errorMessage!, /MAPPING_MISSING/);

  const failUpdate = updates.find((u) => u.state === 'FAILED');
  assert.ok(failUpdate, 'Expected a FAILED state update on the sync record');
  assert.equal(failUpdate.lastErrorCode, 'MAPPING_MISSING');
});

test('processor skips mapping preflight and proceeds when mappings are valid', async () => {
  const { prisma, updates } = makeFakePrisma();
  const processor = new InvoiceSyncProcessor({
    prisma,
    entityMapping: makeEntityMapping(),
    mapping: makeMappingService(null), // all mappings present
  });

  // Will fail later trying to load the work order (returns null), but must
  // NOT produce a MAPPING_MISSING error code
  const result = await processor.processRecord('rec-1', 'acct-1', {} as never);

  assert.notEqual(result.errorCode, 'MAPPING_MISSING');
  const mappingFailUpdate = updates.find((u) => u.lastErrorCode === 'MAPPING_MISSING');
  assert.equal(mappingFailUpdate, undefined, 'Should not produce a MAPPING_MISSING update');
});
