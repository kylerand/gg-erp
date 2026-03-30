import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  CustomerSyncService,
  type CustomerSyncQueries,
} from '../contexts/accounting/customerSync.service.js';
import {
  CustomerSyncState,
  type CustomerSyncRecord,
} from '../../../../packages/domain/src/model/accounting.js';
import { EntityMappingService } from '../contexts/accounting/entityMapping.service.js';

// Stub entityMapping for unit tests (no Prisma)
function createStubEntityMapping(): EntityMappingService {
  const mappings = new Map<string, string>();
  return {
    async findExternalId(
      _integrationAccountId: string,
      _entityType: string,
      entityId: string
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
      externalId: string
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

test('customer sync creates PENDING record and emits event', async () => {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const entityMapping = createStubEntityMapping();

  const service = new CustomerSyncService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks,
    entityMapping,
    queries: createMockCustomerSyncQueries(),
  });

  const context = {
    correlationId: 'cust-sync-1',
    actorId: 'system',
    module: 'test',
  };

  const record = await service.queueSync(
    {
      customerId: 'cust-001',
      displayName: 'Acme Corp',
      integrationAccountId: 'int-001',
    },
    context
  );

  assert.equal(record.state, CustomerSyncState.PENDING);
  assert.equal(record.customerId, 'cust-001');
  assert.equal(record.provider, 'QUICKBOOKS');
  assert.equal(record.attemptCount, 0);

  const startedEvent = publisher.published.find((e) => e.name === 'customer_sync.started');
  assert.ok(startedEvent, 'Expected customer_sync.started event');
});

test('customer sync returns existing record if already queued', async () => {
  const service = new CustomerSyncService({
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    entityMapping: createStubEntityMapping(),
    queries: createMockCustomerSyncQueries(),
  });

  const context = { correlationId: 'cust-sync-2', actorId: 'system', module: 'test' };

  const first = await service.queueSync(
    { customerId: 'cust-002', displayName: 'Beta LLC', integrationAccountId: 'int-001' },
    context
  );
  const second = await service.queueSync(
    { customerId: 'cust-002', displayName: 'Beta LLC', integrationAccountId: 'int-001' },
    context
  );

  assert.equal(first.id, second.id, 'Should return same record for duplicate queue');
});

test('customer sync record is retrievable by ID', async () => {
  const service = new CustomerSyncService({
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    entityMapping: createStubEntityMapping(),
    queries: createMockCustomerSyncQueries(),
  });

  const context = { correlationId: 'cust-sync-3', actorId: 'system', module: 'test' };

  const record = await service.queueSync(
    { customerId: 'cust-003', displayName: 'Gamma Inc', integrationAccountId: 'int-001' },
    context
  );

  const retrieved = await service.getRecord(record.id);
  assert.ok(retrieved);
  assert.equal(retrieved.id, record.id);
  assert.equal(retrieved.customerId, 'cust-003');
});

test('customer sync listByState filters correctly', async () => {
  const service = new CustomerSyncService({
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    entityMapping: createStubEntityMapping(),
    queries: createMockCustomerSyncQueries(),
  });

  const context = { correlationId: 'cust-sync-4', actorId: 'system', module: 'test' };

  await service.queueSync(
    { customerId: 'cust-004', displayName: 'Delta Co', integrationAccountId: 'int-001' },
    context
  );
  await service.queueSync(
    { customerId: 'cust-005', displayName: 'Epsilon Ltd', integrationAccountId: 'int-001' },
    context
  );

  const pending = await service.listByState(CustomerSyncState.PENDING);
  assert.equal(pending.length, 2);

  const synced = await service.listByState(CustomerSyncState.SYNCED);
  assert.equal(synced.length, 0);
});
