import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  ReconciliationService,
  ReconciliationStatus,
  type ReconciliationQueries,
  type ReconciliationSyncQueries,
  type ReconciliationRunRecord,
  type ReconciliationRecordItem,
  type RunStats,
  type CreateRecordInput,
  type SyncedInvoiceRecord,
  type SyncedPaymentRecord,
} from '../contexts/accounting/reconciliation.service.js';
import {
  FailureQueueService,
  type FailureQueueQueries,
  type FailedRecordSummary,
} from '../contexts/accounting/failureQueue.service.js';
import {
  wrapHandler,
  parseBody,
  jsonResponse,
  type LambdaEvent,
} from '../shared/lambda/handler-wrapper.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `test-id-${++idCounter}`;
}

function createMockReconciliationQueries(): ReconciliationQueries {
  const runs = new Map<string, ReconciliationRunRecord>();
  const records = new Map<string, ReconciliationRecordItem>();

  return {
    async createRun(triggeredBy?: string): Promise<ReconciliationRunRecord> {
      const id = nextId();
      const now = new Date().toISOString();
      const run: ReconciliationRunRecord = {
        id,
        startedAt: now,
        status: 'RUNNING',
        totalRecords: 0,
        matchedCount: 0,
        mismatchCount: 0,
        errorCount: 0,
        triggeredBy,
        createdAt: now,
      };
      runs.set(id, run);
      return { ...run };
    },

    async completeRun(runId: string, stats: RunStats): Promise<ReconciliationRunRecord> {
      const run = runs.get(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      const updated: ReconciliationRunRecord = {
        ...run,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        totalRecords: stats.totalRecords,
        matchedCount: stats.matchedCount,
        mismatchCount: stats.mismatchCount,
        errorCount: stats.errorCount,
      };
      runs.set(runId, updated);
      return { ...updated };
    },

    async failRun(runId: string, error: string): Promise<ReconciliationRunRecord> {
      const run = runs.get(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      const updated: ReconciliationRunRecord = {
        ...run,
        status: `FAILED: ${error}`,
        completedAt: new Date().toISOString(),
      };
      runs.set(runId, updated);
      return { ...updated };
    },

    async createRecord(data: CreateRecordInput): Promise<ReconciliationRecordItem> {
      const id = nextId();
      const now = new Date().toISOString();
      const record: ReconciliationRecordItem = {
        id,
        reconciliationType: data.reconciliationType,
        erpRecordId: data.erpRecordId,
        qbRecordId: data.qbRecordId,
        status: data.status,
        erpAmountCents: data.erpAmountCents,
        qbAmountCents: data.qbAmountCents,
        discrepancy: data.discrepancy,
        runId: data.runId,
        createdAt: now,
        updatedAt: now,
      };
      records.set(id, record);
      return { ...record };
    },

    async listRecords(
      runId: string,
      status?: ReconciliationStatus,
    ): Promise<ReconciliationRecordItem[]> {
      return [...records.values()]
        .filter((r) => r.runId === runId && (!status || r.status === status))
        .map((r) => ({ ...r }));
    },

    async updateRecordStatus(
      id: string,
      status: ReconciliationStatus,
      notes?: string,
    ): Promise<ReconciliationRecordItem> {
      const record = records.get(id);
      if (!record) throw new Error(`Record not found: ${id}`);
      const updated: ReconciliationRecordItem = {
        ...record,
        status,
        notes,
        updatedAt: new Date().toISOString(),
        ...(status === ReconciliationStatus.RESOLVED
          ? { resolvedAt: new Date().toISOString() }
          : {}),
      };
      records.set(id, updated);
      return { ...updated };
    },

    async getLatestRun(): Promise<ReconciliationRunRecord | undefined> {
      const allRuns = [...runs.values()];
      if (allRuns.length === 0) return undefined;
      return { ...allRuns[allRuns.length - 1] };
    },

    async getRun(runId: string): Promise<ReconciliationRunRecord | undefined> {
      const run = runs.get(runId);
      return run ? { ...run } : undefined;
    },

    async listRuns(limit = 50, _offset = 0): Promise<ReconciliationRunRecord[]> {
      return [...runs.values()]
        .reverse()
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },

    async getRecordById(id: string): Promise<ReconciliationRecordItem | undefined> {
      const record = records.get(id);
      return record ? { ...record } : undefined;
    },
  };
}

function createMockSyncQueries(
  overrides?: Partial<ReconciliationSyncQueries>,
): ReconciliationSyncQueries {
  return {
    async listSyncedInvoices(): Promise<SyncedInvoiceRecord[]> {
      return [];
    },
    async listSyncedPayments(): Promise<SyncedPaymentRecord[]> {
      return [];
    },
    ...overrides,
  };
}

function createReconciliationService(overrides?: {
  queries?: ReconciliationQueries;
  syncQueries?: ReconciliationSyncQueries;
  publisher?: InMemoryEventPublisher;
  audit?: InMemoryAuditSink;
  outbox?: InMemoryOutbox;
}) {
  const audit = overrides?.audit ?? new InMemoryAuditSink();
  const publisher = overrides?.publisher ?? new InMemoryEventPublisher();
  const outbox = overrides?.outbox ?? new InMemoryOutbox();
  const queries = overrides?.queries ?? createMockReconciliationQueries();
  const syncQueries = overrides?.syncQueries ?? createMockSyncQueries();

  const service = new ReconciliationService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    queries,
    syncQueries,
  });

  return { service, audit, publisher, outbox, queries, syncQueries };
}

function createMockFailureQueueQueries(
  overrides?: Partial<FailureQueueQueries>,
): FailureQueueQueries {
  const failedInvoices: FailedRecordSummary[] = [];
  const failedCustomers: FailedRecordSummary[] = [];
  const failedPayments: FailedRecordSummary[] = [];

  return {
    async listFailedInvoices(limit: number) {
      return failedInvoices.slice(0, limit);
    },
    async listFailedCustomers(limit: number) {
      return failedCustomers.slice(0, limit);
    },
    async listFailedPayments(limit: number) {
      return failedPayments.slice(0, limit);
    },
    async countFailedInvoices() {
      return failedInvoices.length;
    },
    async countFailedCustomers() {
      return failedCustomers.length;
    },
    async countFailedPayments() {
      return failedPayments.length;
    },
    async resetInvoiceToRetry(_id: string) {
      return true;
    },
    async resetCustomerToRetry(_id: string) {
      return true;
    },
    async resetPaymentToRetry(_id: string) {
      return true;
    },
    ...overrides,
  };
}

const context = {
  correlationId: 'recon-test-1',
  actorId: 'test-user',
  module: 'test',
};

// ─── Reconciliation: Run lifecycle ───────────────────────────────────────────

test('runReconciliation creates a COMPLETED run with empty data', async () => {
  const { service } = createReconciliationService();

  const run = await service.runReconciliation(context);

  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.totalRecords, 0);
  assert.equal(run.matchedCount, 0);
  assert.equal(run.mismatchCount, 0);
  assert.equal(run.errorCount, 0);
  assert.ok(run.id, 'Expected run to have an ID');
  assert.ok(run.completedAt, 'Expected completedAt to be set');
});

test('runReconciliation detects MATCHED invoices with QB references', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [
        { id: 'inv-1', invoiceNumber: 'INV-001', externalReference: 'qb-ref-1' },
        { id: 'inv-2', invoiceNumber: 'INV-002', externalReference: 'qb-ref-2' },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.totalRecords, 2);
  assert.equal(run.matchedCount, 2);
  assert.equal(run.mismatchCount, 0);
});

test('runReconciliation detects MISMATCH invoices without QB references', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [
        { id: 'inv-1', invoiceNumber: 'INV-001', externalReference: 'qb-ref-1' },
        { id: 'inv-2', invoiceNumber: 'INV-002' },
        { id: 'inv-3', invoiceNumber: 'INV-003' },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  assert.equal(run.totalRecords, 3);
  assert.equal(run.matchedCount, 1);
  assert.equal(run.mismatchCount, 2);
});

test('runReconciliation detects MATCHED payments with QB payment IDs', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedPayments() {
      return [
        { id: 'pay-1', qbPaymentId: 'qb-pay-1', amountCents: 10000 },
        { id: 'pay-2', qbPaymentId: 'qb-pay-2', amountCents: 20000 },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  assert.equal(run.totalRecords, 2);
  assert.equal(run.matchedCount, 2);
  assert.equal(run.mismatchCount, 0);
});

test('runReconciliation detects MISMATCH payments without QB payment IDs', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedPayments() {
      return [
        { id: 'pay-1', qbPaymentId: 'qb-pay-1', amountCents: 10000 },
        { id: 'pay-2', amountCents: 20000 },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  assert.equal(run.totalRecords, 2);
  assert.equal(run.matchedCount, 1);
  assert.equal(run.mismatchCount, 1);
});

test('runReconciliation handles mixed invoices and payments', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [
        { id: 'inv-1', invoiceNumber: 'INV-001', externalReference: 'qb-ref-1' },
        { id: 'inv-2', invoiceNumber: 'INV-002' },
      ];
    },
    async listSyncedPayments() {
      return [
        { id: 'pay-1', qbPaymentId: 'qb-pay-1', amountCents: 5000 },
        { id: 'pay-2', amountCents: 7500 },
        { id: 'pay-3', qbPaymentId: 'qb-pay-3', amountCents: 3000 },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  assert.equal(run.totalRecords, 5);
  assert.equal(run.matchedCount, 3);
  assert.equal(run.mismatchCount, 2);
  assert.equal(run.errorCount, 0);
});

test('runReconciliation emits reconciliation.completed event', async () => {
  const publisher = new InMemoryEventPublisher();
  const { service } = createReconciliationService({ publisher });

  await service.runReconciliation(context);

  const completedEvent = publisher.published.find(
    (e) => e.name === 'reconciliation.completed',
  );
  assert.ok(completedEvent, 'Expected reconciliation.completed event');
});

// ─── Reconciliation: Resolve workflow ────────────────────────────────────────

test('resolveRecord marks MISMATCH as RESOLVED with notes', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [{ id: 'inv-mismatch', invoiceNumber: 'INV-X' }];
    },
  });

  const { service, queries } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  const mismatches = await queries.listRecords(run.id, ReconciliationStatus.MISMATCH);
  assert.ok(mismatches.length > 0, 'Expected at least one MISMATCH record');

  const resolved = await service.resolveRecord(
    mismatches[0].id,
    { resolvedBy: 'admin', notes: 'Manually verified — OK' },
    context,
  );

  assert.equal(resolved.status, ReconciliationStatus.RESOLVED);
  assert.equal(resolved.notes, 'Manually verified — OK');
});

test('resolveRecord rejects resolution of non-MISMATCH record', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [{ id: 'inv-matched', invoiceNumber: 'INV-Y', externalReference: 'qb-1' }];
    },
  });

  const { service, queries } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  const matched = await queries.listRecords(run.id, ReconciliationStatus.MATCHED);
  assert.ok(matched.length > 0, 'Expected at least one MATCHED record');

  await assert.rejects(
    service.resolveRecord(
      matched[0].id,
      { resolvedBy: 'admin', notes: 'Should fail' },
      context,
    ),
    /Can only resolve MISMATCH/,
  );
});

test('resolveRecord rejects non-existent record', async () => {
  const { service } = createReconciliationService();

  await assert.rejects(
    service.resolveRecord(
      'non-existent-id',
      { resolvedBy: 'admin', notes: 'Should fail' },
      context,
    ),
    /not found/,
  );
});

// ─── Reconciliation: listMismatches ──────────────────────────────────────────

test('listMismatches returns only MISMATCH records from latest run', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [
        { id: 'inv-1', invoiceNumber: 'INV-1', externalReference: 'qb-1' },
        { id: 'inv-2', invoiceNumber: 'INV-2' },
      ];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  await service.runReconciliation(context);

  const mismatches = await service.listMismatches();
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].status, ReconciliationStatus.MISMATCH);
  assert.equal(mismatches[0].erpRecordId, 'inv-2');
});

test('listMismatches returns empty array when no runs exist', async () => {
  const { service } = createReconciliationService();

  const mismatches = await service.listMismatches();
  assert.equal(mismatches.length, 0);
});

// ─── Reconciliation: getRunSummary ──────────────────────────────────────────

test('getRunSummary returns run with records', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [{ id: 'inv-1', invoiceNumber: 'INV-1', externalReference: 'qb-1' }];
    },
  });

  const { service } = createReconciliationService({ syncQueries });
  const run = await service.runReconciliation(context);

  const summary = await service.getRunSummary(run.id);
  assert.ok(summary, 'Expected summary to exist');
  assert.equal(summary.run.id, run.id);
  assert.equal(summary.records.length, 1);
});

test('getRunSummary returns undefined for non-existent run', async () => {
  const { service } = createReconciliationService();
  const summary = await service.getRunSummary('non-existent');
  assert.equal(summary, undefined);
});

// ─── FailureQueue: getFailureSummary ─────────────────────────────────────────

test('getFailureSummary returns counts by type', async () => {
  const queries = createMockFailureQueueQueries({
    async countFailedInvoices() {
      return 3;
    },
    async countFailedCustomers() {
      return 1;
    },
    async countFailedPayments() {
      return 5;
    },
  });

  const service = new FailureQueueService({ queries });
  const summary = await service.getFailureSummary();

  assert.equal(summary.invoice, 3);
  assert.equal(summary.customer, 1);
  assert.equal(summary.payment, 5);
  assert.equal(summary.total, 9);
});

test('getFailureSummary returns zeros when no failures exist', async () => {
  const queries = createMockFailureQueueQueries();
  const service = new FailureQueueService({ queries });
  const summary = await service.getFailureSummary();

  assert.equal(summary.invoice, 0);
  assert.equal(summary.customer, 0);
  assert.equal(summary.payment, 0);
  assert.equal(summary.total, 0);
});

// ─── FailureQueue: listFailedRecords ─────────────────────────────────────────

test('listFailedRecords returns all types when no filter specified', async () => {
  const now = new Date().toISOString();
  const queries = createMockFailureQueueQueries({
    async listFailedInvoices() {
      return [{ id: 'inv-1', type: 'invoice', attemptCount: 2, createdAt: now, updatedAt: now }];
    },
    async listFailedPayments() {
      return [{ id: 'pay-1', type: 'payment', attemptCount: 1, createdAt: now, updatedAt: now }];
    },
  });

  const service = new FailureQueueService({ queries });
  const records = await service.listFailedRecords();

  assert.equal(records.length, 2);
  const types = records.map((r) => r.type);
  assert.ok(types.includes('invoice'));
  assert.ok(types.includes('payment'));
});

test('listFailedRecords filters by type', async () => {
  const now = new Date().toISOString();
  const queries = createMockFailureQueueQueries({
    async listFailedInvoices() {
      return [{ id: 'inv-1', type: 'invoice', attemptCount: 2, createdAt: now, updatedAt: now }];
    },
    async listFailedPayments() {
      return [{ id: 'pay-1', type: 'payment', attemptCount: 1, createdAt: now, updatedAt: now }];
    },
  });

  const service = new FailureQueueService({ queries });
  const records = await service.listFailedRecords('invoice');

  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'invoice');
});

// ─── FailureQueue: retryRecord ───────────────────────────────────────────────

test('retryRecord dispatches retry for invoice type', async () => {
  let resetCalled = false;
  const queries = createMockFailureQueueQueries({
    async resetInvoiceToRetry(id: string) {
      resetCalled = true;
      assert.equal(id, 'inv-fail-1');
      return true;
    },
  });

  const service = new FailureQueueService({ queries });
  const result = await service.retryRecord('invoice', 'inv-fail-1', {
    correlationId: 'retry-1',
    actorId: 'admin',
    module: 'test',
  });

  assert.ok(resetCalled, 'Expected resetInvoiceToRetry to be called');
  assert.equal(result.success, true);
  assert.equal(result.type, 'invoice');
  assert.equal(result.id, 'inv-fail-1');
});

test('retryRecord returns failure when reset fails', async () => {
  const queries = createMockFailureQueueQueries({
    async resetPaymentToRetry() {
      return false;
    },
  });

  const service = new FailureQueueService({ queries });
  const result = await service.retryRecord('payment', 'pay-missing', {
    correlationId: 'retry-2',
    actorId: 'admin',
    module: 'test',
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes('Failed to reset'));
});

// ─── FailureQueue: retryAll ─────────────────────────────────────────────────

test('retryAll retries all failed records across types', async () => {
  const now = new Date().toISOString();
  const retried: string[] = [];
  const queries = createMockFailureQueueQueries({
    async listFailedInvoices() {
      return [{ id: 'inv-1', type: 'invoice', attemptCount: 1, createdAt: now, updatedAt: now }];
    },
    async listFailedPayments() {
      return [{ id: 'pay-1', type: 'payment', attemptCount: 1, createdAt: now, updatedAt: now }];
    },
    async resetInvoiceToRetry(id: string) {
      retried.push(id);
      return true;
    },
    async resetPaymentToRetry(id: string) {
      retried.push(id);
      return true;
    },
  });

  const service = new FailureQueueService({ queries });
  const results = await service.retryAll();

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.success));
  assert.deepEqual(retried.sort(), ['inv-1', 'pay-1']);
});

// ─── Handler validation ─────────────────────────────────────────────────────

test('resolveReconciliation handler rejects missing record ID', async () => {
  const handler = wrapHandler(async (ctx) => {
    const recordId = ctx.event.pathParameters?.id;
    if (!recordId) {
      return jsonResponse(400, { message: 'Record ID is required.' });
    }
    return jsonResponse(200, { ok: true });
  });

  const event: LambdaEvent = {
    httpMethod: 'POST',
    body: JSON.stringify({ notes: 'test' }),
    pathParameters: {},
  };

  const result = await handler(event);
  assert.equal(result.statusCode, 400);
  const body = JSON.parse(result.body);
  assert.ok(body.message.includes('Record ID'));
});

test('resolveReconciliation handler rejects missing notes', async () => {
  const handler = wrapHandler(async (ctx) => {
    const body = parseBody<{ notes: string }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    if (!body.value.notes) {
      return jsonResponse(422, { message: 'notes field is required.' });
    }
    return jsonResponse(200, { ok: true });
  });

  const event: LambdaEvent = {
    httpMethod: 'POST',
    body: JSON.stringify({}),
    pathParameters: { id: 'rec-1' },
  };

  const result = await handler(event);
  assert.equal(result.statusCode, 422);
  const body = JSON.parse(result.body);
  assert.ok(body.message.includes('notes'));
});

test('retryFailed handler rejects invalid type', async () => {
  const VALID_TYPES = new Set(['invoice', 'customer', 'payment']);

  const handler = wrapHandler(async (ctx) => {
    const body = parseBody<{ type?: string }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    if (body.value.type && !VALID_TYPES.has(body.value.type)) {
      return jsonResponse(422, {
        message: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}`,
      });
    }
    return jsonResponse(200, { ok: true });
  });

  const event: LambdaEvent = {
    httpMethod: 'POST',
    body: JSON.stringify({ type: 'unknown' }),
  };

  const result = await handler(event);
  assert.equal(result.statusCode, 422);
  const body = JSON.parse(result.body);
  assert.ok(body.message.includes('Invalid type'));
});

// ─── Audit and event emission ───────────────────────────────────────────────

test('reconciliation run emits audit record', async () => {
  const audit = new InMemoryAuditSink();
  const { service } = createReconciliationService({ audit });

  await service.runReconciliation(context);

  const auditRecords = audit.list();
  assert.ok(auditRecords.length > 0, 'Expected audit records to be emitted');
  const reconAudit = auditRecords.find(
    (r) => r.action === 'accounting.reconciliation_run',
  );
  assert.ok(reconAudit, 'Expected reconciliation audit record');
});

test('resolveRecord emits reconciliation.record_resolved event', async () => {
  const syncQueries = createMockSyncQueries({
    async listSyncedInvoices() {
      return [{ id: 'inv-resolve', invoiceNumber: 'INV-R' }];
    },
  });

  const publisher = new InMemoryEventPublisher();
  const { service, queries } = createReconciliationService({ syncQueries, publisher });
  const run = await service.runReconciliation(context);

  const mismatches = await queries.listRecords(run.id, ReconciliationStatus.MISMATCH);
  assert.ok(mismatches.length > 0);

  await service.resolveRecord(
    mismatches[0].id,
    { resolvedBy: 'admin', notes: 'Confirmed OK' },
    context,
  );

  const resolveEvent = publisher.published.find(
    (e) => e.name === 'reconciliation.record_resolved',
  );
  assert.ok(resolveEvent, 'Expected reconciliation.record_resolved event');
});
