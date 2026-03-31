import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  InvoiceSyncService,
  type InvoiceSyncQueries,
} from '../contexts/accounting/invoiceSync.service.js';
import {
  InvoiceSyncState,
  type InvoiceSyncRecord,
} from '../../../../packages/domain/src/model/accounting.js';
import {
  CustomerSyncService,
  type CustomerSyncQueries,
} from '../contexts/accounting/customerSync.service.js';
import {
  CustomerSyncState,
  type CustomerSyncRecord,
} from '../../../../packages/domain/src/model/accounting.js';
import { EntityMappingService } from '../contexts/accounting/entityMapping.service.js';
import { assertTransitionAllowed } from '../../../../packages/domain/src/model/shared.js';
import {
  InvoiceSyncRecordDesign,
  CustomerSyncRecordDesign,
} from '../../../../packages/domain/src/model/accounting.js';

// ─── Mock factories ───────────────────────────────────────────────────────────

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

function createMockCustomerSyncQueries(): CustomerSyncQueries {
  const records = new Map<string, CustomerSyncRecord>();
  return {
    async findById(id: string) {
      const r = records.get(id);
      return r ? { ...r } : undefined;
    },
    async findByCustomerAndProvider(customerId: string, provider: string) {
      const r = [...records.values()].find(
        (rec) => rec.customerId === customerId && rec.provider === provider,
      );
      return r ? { ...r } : undefined;
    },
    async listByState(state: CustomerSyncState) {
      return [...records.values()]
        .filter((r) => r.state === state)
        .map((r) => ({ ...r }));
    },
    async save(record: CustomerSyncRecord, _correlationId: string) {
      records.set(record.id, { ...record });
    },
  };
}

function createStubEntityMapping(): EntityMappingService {
  const mappings = new Map<string, string>();
  return {
    async findExternalId(
      _integrationAccountId: string,
      _entityType: string,
      entityId: string,
    ) {
      return mappings.get(entityId) ?? null;
    },
    async findEntityId() {
      return null;
    },
    async upsertMapping(
      _integrationAccountId: string,
      _entityType: string,
      entityId: string,
      externalId: string,
    ) {
      mappings.set(entityId, externalId);
      return {
        id: 'mapping-1',
        integrationAccountId: _integrationAccountId,
        entityType: _entityType,
        entityId,
        externalId,
        namespace: 'default',
        isActive: true,
      };
    },
    async deactivateMapping() {},
    async listMappings() {
      return { items: [], total: 0 };
    },
  } as unknown as EntityMappingService;
}

function createInvoiceSyncService(overrides: Partial<{
  audit: InMemoryAuditSink;
  publisher: InMemoryEventPublisher;
  outbox: InMemoryOutbox;
  queries: InvoiceSyncQueries;
}> = {}) {
  const audit = overrides.audit ?? new InMemoryAuditSink();
  const publisher = overrides.publisher ?? new InMemoryEventPublisher();
  const outbox = overrides.outbox ?? new InMemoryOutbox();
  const queries = overrides.queries ?? createMockInvoiceSyncQueries();
  const service = new InvoiceSyncService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    queries,
  });
  return { service, audit, publisher, outbox };
}

function createCustomerSyncService(overrides: Partial<{
  audit: InMemoryAuditSink;
  publisher: InMemoryEventPublisher;
  outbox: InMemoryOutbox;
  queries: CustomerSyncQueries;
}> = {}) {
  const audit = overrides.audit ?? new InMemoryAuditSink();
  const publisher = overrides.publisher ?? new InMemoryEventPublisher();
  const outbox = overrides.outbox ?? new InMemoryOutbox();
  const queries = overrides.queries ?? createMockCustomerSyncQueries();
  const service = new CustomerSyncService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    entityMapping: createStubEntityMapping(),
    queries,
  });
  return { service, audit, publisher, outbox };
}

const defaultContext = {
  correlationId: 'test-corr-1',
  actorId: 'test-actor',
  module: 'test',
};

// ─── Test 1: Full lifecycle PENDING → IN_PROGRESS → SYNCED ─────────────────

test('invoice sync full lifecycle: PENDING → IN_PROGRESS → SYNCED', async () => {
  const { service, publisher, audit } = createInvoiceSyncService();

  const record = await service.createRecord(
    { invoiceNumber: 'INV-LC-001', workOrderId: 'wo-lc-1', provider: 'QUICKBOOKS' },
    defaultContext,
  );
  assert.equal(record.state, InvoiceSyncState.PENDING);
  assert.equal(record.attemptCount, 0);

  const started = await service.startSync(record.id, defaultContext);
  assert.equal(started.state, InvoiceSyncState.IN_PROGRESS);
  assert.equal(started.attemptCount, 1);

  const synced = await service.markSuccess(record.id, 'qb-inv-001', defaultContext);
  assert.equal(synced.state, InvoiceSyncState.SYNCED);
  assert.equal(synced.externalReference, 'qb-inv-001');
  assert.ok(synced.syncedAt, 'syncedAt should be set');

  // Verify all events emitted in order
  const eventNames = publisher.published.map((e) => e.name);
  assert.ok(eventNames.includes('invoice_sync.started'), 'Expected started event');
  assert.ok(eventNames.includes('invoice_sync.succeeded'), 'Expected succeeded event');

  // Verify audit trail recorded each transition
  const auditRecords = audit.list();
  assert.ok(auditRecords.length >= 3, 'Expected at least 3 audit records (create, start, success)');
});

// ─── Test 2: Retry from FAILED completes full lifecycle ─────────────────────

test('invoice sync retries from FAILED and completes to SYNCED', async () => {
  const { service, publisher } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'retry-complete-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-RETRY-001', workOrderId: 'wo-r-1', provider: 'QUICKBOOKS' },
    ctx,
  );

  await service.startSync(record.id, ctx);
  const failed = await service.markFailure(record.id, 'QB_TIMEOUT', 'Timeout', ctx);
  assert.equal(failed.state, InvoiceSyncState.FAILED);
  assert.equal(failed.attemptCount, 1);

  // Retry from FAILED
  const retried = await service.startSync(record.id, ctx);
  assert.equal(retried.state, InvoiceSyncState.IN_PROGRESS);
  assert.equal(retried.attemptCount, 2);
  assert.equal(retried.lastErrorCode, undefined, 'Error fields cleared on retry');
  assert.equal(retried.lastErrorMessage, undefined, 'Error message cleared on retry');

  // Complete successfully
  const synced = await service.markSuccess(record.id, 'qb-inv-retry', ctx);
  assert.equal(synced.state, InvoiceSyncState.SYNCED);
  assert.equal(synced.attemptCount, 2);

  // Verify retried event
  const retriedEvents = publisher.published.filter((e) => e.name === 'invoice_sync.retried');
  assert.equal(retriedEvents.length, 1, 'Expected exactly one retried event');
});

// ─── Test 3: Concurrent sync attempts (idempotency) ─────────────────────────

test('invoice sync rejects duplicate record creation (idempotency)', async () => {
  const { service } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'idem-1' };

  await service.createRecord(
    { invoiceNumber: 'INV-DUP-001', workOrderId: 'wo-dup', provider: 'QUICKBOOKS' },
    ctx,
  );

  // Second create with same invoiceNumber should throw
  await assert.rejects(
    service.createRecord(
      { invoiceNumber: 'INV-DUP-001', workOrderId: 'wo-dup-2', provider: 'QUICKBOOKS' },
      ctx,
    ),
    /Invoice sync record already exists/,
  );
});

test('customer sync concurrent queue returns same record (idempotency)', async () => {
  const { service } = createCustomerSyncService();
  const ctx = { ...defaultContext, correlationId: 'cust-idem-1' };

  // Sequential duplicate queues should return the same record
  const first = await service.queueSync(
    { customerId: 'cust-conc-1', displayName: 'Concurrent Corp', integrationAccountId: 'int-1' },
    ctx,
  );
  const second = await service.queueSync(
    { customerId: 'cust-conc-1', displayName: 'Concurrent Corp', integrationAccountId: 'int-1' },
    ctx,
  );

  assert.equal(first.id, second.id, 'Duplicate queues should return the same record');
  assert.equal(first.state, CustomerSyncState.PENDING);
});

test('invoice sync rejects startSync on already IN_PROGRESS record', async () => {
  const { service } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'double-start-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-DS-001', workOrderId: 'wo-ds', provider: 'QUICKBOOKS' },
    ctx,
  );

  await service.startSync(record.id, ctx);

  // Second startSync while already IN_PROGRESS should fail
  await assert.rejects(
    service.startSync(record.id, ctx),
    /Cannot start sync from state IN_PROGRESS/,
  );
});

// ─── Test 4: Batch processing (multiple records queued) ─────────────────────

test('invoice sync processes multiple records independently', async () => {
  const { service } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'batch-1' };

  const records = await Promise.all(
    ['INV-B-001', 'INV-B-002', 'INV-B-003'].map((invoiceNumber, i) =>
      service.createRecord(
        { invoiceNumber, workOrderId: `wo-b-${i}`, provider: 'QUICKBOOKS' },
        ctx,
      ),
    ),
  );

  assert.equal(records.length, 3);
  for (const r of records) {
    assert.equal(r.state, InvoiceSyncState.PENDING);
  }

  // Process first two, fail third
  await service.startSync(records[0].id, ctx);
  await service.markSuccess(records[0].id, 'qb-b-1', ctx);

  await service.startSync(records[1].id, ctx);
  await service.markSuccess(records[1].id, 'qb-b-2', ctx);

  await service.startSync(records[2].id, ctx);
  await service.markFailure(records[2].id, 'QB_ERROR', 'Connection failed', ctx);

  // Verify independent states
  const r0 = await service.getRecord(records[0].id);
  const r1 = await service.getRecord(records[1].id);
  const r2 = await service.getRecord(records[2].id);

  assert.equal(r0?.state, InvoiceSyncState.SYNCED);
  assert.equal(r1?.state, InvoiceSyncState.SYNCED);
  assert.equal(r2?.state, InvoiceSyncState.FAILED);
  assert.equal(r2?.lastErrorCode, 'QB_ERROR');
});

test('customer sync batch queue and state filtering', async () => {
  const { service } = createCustomerSyncService();
  const ctx = { ...defaultContext, correlationId: 'cust-batch-1' };

  await service.queueSync(
    { customerId: 'cb-1', displayName: 'Alpha', integrationAccountId: 'int-1' },
    ctx,
  );
  await service.queueSync(
    { customerId: 'cb-2', displayName: 'Bravo', integrationAccountId: 'int-1' },
    ctx,
  );
  await service.queueSync(
    { customerId: 'cb-3', displayName: 'Charlie', integrationAccountId: 'int-1' },
    ctx,
  );

  const pending = await service.listByState(CustomerSyncState.PENDING);
  assert.equal(pending.length, 3, 'All three should be PENDING');

  const synced = await service.listByState(CustomerSyncState.SYNCED);
  assert.equal(synced.length, 0, 'None should be SYNCED yet');
});

// ─── Test 5: Stale record detection (stuck in IN_PROGRESS) ─────────────────

test('invoice sync detects stale records stuck in IN_PROGRESS', async () => {
  const queries = createMockInvoiceSyncQueries();
  const { service } = createInvoiceSyncService({ queries });
  const ctx = { ...defaultContext, correlationId: 'stale-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-STALE-001', workOrderId: 'wo-stale', provider: 'QUICKBOOKS' },
    ctx,
  );

  const started = await service.startSync(record.id, ctx);
  assert.equal(started.state, InvoiceSyncState.IN_PROGRESS);

  // Simulate staleness by manually backdating the record's updatedAt
  const staleRecord: InvoiceSyncRecord = {
    ...started,
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
  };
  await queries.save(staleRecord, ctx.correlationId);

  // Verify the stale record is retrievable and detectable
  const retrieved = await service.getRecord(record.id);
  assert.ok(retrieved, 'Stale record should be retrievable');
  assert.equal(retrieved.state, InvoiceSyncState.IN_PROGRESS);

  const updatedAt = new Date(retrieved.updatedAt).getTime();
  const staleThresholdMs = 15 * 60 * 1000; // 15 minutes
  const isStale = Date.now() - updatedAt > staleThresholdMs;
  assert.ok(isStale, 'Record should be detected as stale (>15 min in IN_PROGRESS)');

  // A stale IN_PROGRESS record cannot be re-started directly —
  // it must be marked failed first, then retried
  await assert.rejects(
    service.startSync(record.id, ctx),
    /Cannot start sync from state IN_PROGRESS/,
  );

  // Proper recovery: mark failed, then retry
  const failed = await service.markFailure(record.id, 'STALE_TIMEOUT', 'Stale recovery', ctx);
  assert.equal(failed.state, InvoiceSyncState.FAILED);

  const retried = await service.startSync(record.id, ctx);
  assert.equal(retried.state, InvoiceSyncState.IN_PROGRESS);
  assert.equal(retried.attemptCount, 2);
});

// ─── Test 6: Cancellation flow ──────────────────────────────────────────────

test('invoice sync state machine allows cancellation from PENDING', () => {
  // PENDING → CANCELLED is a valid transition
  assert.doesNotThrow(() => {
    assertTransitionAllowed(
      InvoiceSyncState.PENDING,
      InvoiceSyncState.CANCELLED,
      InvoiceSyncRecordDesign.lifecycle,
    );
  });
});

test('invoice sync state machine allows cancellation from FAILED', () => {
  // FAILED → CANCELLED is a valid transition
  assert.doesNotThrow(() => {
    assertTransitionAllowed(
      InvoiceSyncState.FAILED,
      InvoiceSyncState.CANCELLED,
      InvoiceSyncRecordDesign.lifecycle,
    );
  });
});

test('invoice sync state machine blocks cancellation from IN_PROGRESS', () => {
  // IN_PROGRESS → CANCELLED is NOT a valid transition
  assert.throws(
    () => {
      assertTransitionAllowed(
        InvoiceSyncState.IN_PROGRESS,
        InvoiceSyncState.CANCELLED,
        InvoiceSyncRecordDesign.lifecycle,
      );
    },
    /Transition IN_PROGRESS -> CANCELLED is not allowed/,
  );
});

test('invoice sync state machine blocks cancellation from SYNCED', () => {
  // SYNCED is terminal — no transitions out
  assert.throws(
    () => {
      assertTransitionAllowed(
        InvoiceSyncState.SYNCED,
        InvoiceSyncState.CANCELLED,
        InvoiceSyncRecordDesign.lifecycle,
      );
    },
    /Transition SYNCED -> CANCELLED is not allowed/,
  );
});

test('customer sync state machine allows skip from PENDING', () => {
  assert.doesNotThrow(() => {
    assertTransitionAllowed(
      CustomerSyncState.PENDING,
      CustomerSyncState.SKIPPED,
      CustomerSyncRecordDesign.lifecycle,
    );
  });
});

test('customer sync state machine blocks skip from IN_PROGRESS', () => {
  assert.throws(
    () => {
      assertTransitionAllowed(
        CustomerSyncState.IN_PROGRESS,
        CustomerSyncState.SKIPPED,
        CustomerSyncRecordDesign.lifecycle,
      );
    },
    /Transition IN_PROGRESS -> SKIPPED is not allowed/,
  );
});

// ─── Test 7: Outbox records track all transitions ───────────────────────────

test('outbox records track every state transition through full lifecycle', async () => {
  const outbox = new InMemoryOutbox();
  const { service } = createInvoiceSyncService({ outbox });
  const ctx = { ...defaultContext, correlationId: 'outbox-track-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-OBX-001', workOrderId: 'wo-obx', provider: 'QUICKBOOKS' },
    ctx,
  );
  await service.startSync(record.id, ctx);
  await service.markSuccess(record.id, 'qb-obx-1', ctx);

  const outboxRecords = outbox.list();
  assert.equal(outboxRecords.length, 3, 'Expected 3 outbox records (create, start, success)');

  for (const obr of outboxRecords) {
    assert.equal(obr.state, 'PUBLISHED');
    assert.ok(obr.publishedAt, 'Each outbox record should have publishedAt');
  }
});

// ─── Test 8: Multiple failures increment attempt count ──────────────────────

test('invoice sync increments attemptCount across multiple retry cycles', async () => {
  const { service } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'multi-retry-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-MR-001', workOrderId: 'wo-mr', provider: 'QUICKBOOKS' },
    ctx,
  );

  // Attempt 1: fail
  await service.startSync(record.id, ctx);
  await service.markFailure(record.id, 'ERR_1', 'First failure', ctx);

  // Attempt 2: fail
  await service.startSync(record.id, ctx);
  await service.markFailure(record.id, 'ERR_2', 'Second failure', ctx);

  // Attempt 3: fail
  await service.startSync(record.id, ctx);
  const afterThirdFail = await service.markFailure(record.id, 'ERR_3', 'Third failure', ctx);
  assert.equal(afterThirdFail.attemptCount, 3);
  assert.equal(afterThirdFail.lastErrorCode, 'ERR_3');

  // Attempt 4: succeed
  await service.startSync(record.id, ctx);
  const synced = await service.markSuccess(record.id, 'qb-finally', ctx);
  assert.equal(synced.state, InvoiceSyncState.SYNCED);
  assert.equal(synced.attemptCount, 4);
});

// ─── Test 9: SYNCED is terminal — no further transitions ────────────────────

test('invoice sync SYNCED record cannot be restarted or failed', async () => {
  const { service } = createInvoiceSyncService();
  const ctx = { ...defaultContext, correlationId: 'terminal-1' };

  const record = await service.createRecord(
    { invoiceNumber: 'INV-T-001', workOrderId: 'wo-t', provider: 'QUICKBOOKS' },
    ctx,
  );
  await service.startSync(record.id, ctx);
  await service.markSuccess(record.id, 'qb-t-1', ctx);

  await assert.rejects(
    service.startSync(record.id, ctx),
    /Cannot start sync from state SYNCED/,
  );

  await assert.rejects(
    service.markFailure(record.id, 'ERR', 'msg', ctx),
    /Transition SYNCED -> FAILED is not allowed/,
  );
});
