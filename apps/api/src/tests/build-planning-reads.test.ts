import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import {
  BuildSlotState,
} from '../../../../packages/domain/src/model/buildPlanning.js';
import {
  InMemoryWorkOrderRepository,
} from '../contexts/build-planning/workOrder.repository.js';
import { WorkOrderService } from '../contexts/build-planning/workOrder.service.js';
import { createWorkOrderRoutes } from '../contexts/build-planning/workOrder.routes.js';
import {
  listBuildSlotsHandler,
  listLaborCapacityHandler,
  type ApiGatewayProxyEventLike,
} from '../lambda/scheduling/handlers.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createServiceWithRepo() {
  const repository = new InMemoryWorkOrderRepository();
  const service = new WorkOrderService({
    repository,
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  });
  const routes = createWorkOrderRoutes(service);
  return { repository, service, routes };
}

const defaultContext = {
  correlationId: 'bp-test-1',
  actorId: 'test-actor',
  module: 'test',
};

function parseResponseBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

// ─── Build Slot Service Tests ───────────────────────────────────────────────

test('listBuildSlots returns all slots when no filters applied', async () => {
  const { service } = createServiceWithRepo();

  await service.createBuildSlot(
    { slotDate: '2025-01-15', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );
  await service.createBuildSlot(
    { slotDate: '2025-01-16', workstationCode: 'WS-B', capacityHours: 6 },
    defaultContext,
  );

  const slots = await service.listBuildSlots();
  assert.equal(slots.length, 2);
  // Sorted by slotDate ascending
  assert.equal(slots[0].slotDate, '2025-01-15');
  assert.equal(slots[1].slotDate, '2025-01-16');
});

test('listBuildSlots filters by date range', async () => {
  const { service } = createServiceWithRepo();

  await service.createBuildSlot(
    { slotDate: '2025-01-10', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );
  await service.createBuildSlot(
    { slotDate: '2025-01-15', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );
  await service.createBuildSlot(
    { slotDate: '2025-01-20', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );

  const slots = await service.listBuildSlots({
    startDate: '2025-01-12',
    endDate: '2025-01-18',
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].slotDate, '2025-01-15');
});

test('listBuildSlots filters by workstation code', async () => {
  const { service } = createServiceWithRepo();

  await service.createBuildSlot(
    { slotDate: '2025-01-15', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );
  await service.createBuildSlot(
    { slotDate: '2025-01-15', workstationCode: 'WS-B', capacityHours: 6 },
    defaultContext,
  );

  const slots = await service.listBuildSlots({ workstationCode: 'WS-A' });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].workstationCode, 'WS-A');
});

test('listBuildSlots filters by state', async () => {
  const { service } = createServiceWithRepo();

  await service.createBuildSlot(
    { slotDate: '2025-01-15', workstationCode: 'WS-A', capacityHours: 8 },
    defaultContext,
  );
  await service.createBuildSlot(
    { slotDate: '2025-01-16', workstationCode: 'WS-B', capacityHours: 6 },
    defaultContext,
  );

  // All new slots are PLANNED
  const planned = await service.listBuildSlots({ state: BuildSlotState.PLANNED });
  assert.equal(planned.length, 2);

  const locked = await service.listBuildSlots({ state: BuildSlotState.LOCKED });
  assert.equal(locked.length, 0);
});

test('listBuildSlots respects limit and offset', async () => {
  const { service } = createServiceWithRepo();

  for (let i = 1; i <= 5; i++) {
    await service.createBuildSlot(
      { slotDate: `2025-01-${String(i + 10)}`, workstationCode: 'WS-A', capacityHours: 8 },
      defaultContext,
    );
  }

  const page1 = await service.listBuildSlots({ limit: 2, offset: 0 });
  assert.equal(page1.length, 2);
  assert.equal(page1[0].slotDate, '2025-01-11');

  const page2 = await service.listBuildSlots({ limit: 2, offset: 2 });
  assert.equal(page2.length, 2);
  assert.equal(page2[0].slotDate, '2025-01-13');
});

// ─── Labor Capacity Service Tests ───────────────────────────────────────────

test('listLaborCapacity returns all records when no filters applied', async () => {
  const { service } = createServiceWithRepo();

  await service.createLaborCapacity(
    { capacityDate: '2025-01-15', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );
  await service.createLaborCapacity(
    { capacityDate: '2025-01-16', teamCode: 'TEAM-B', availableHours: 32 },
    defaultContext,
  );

  const records = await service.listLaborCapacity();
  assert.equal(records.length, 2);
  assert.equal(records[0].capacityDate, '2025-01-15');
  assert.equal(records[1].capacityDate, '2025-01-16');
});

test('listLaborCapacity filters by date range', async () => {
  const { service } = createServiceWithRepo();

  await service.createLaborCapacity(
    { capacityDate: '2025-01-10', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );
  await service.createLaborCapacity(
    { capacityDate: '2025-01-15', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );
  await service.createLaborCapacity(
    { capacityDate: '2025-01-20', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );

  const records = await service.listLaborCapacity({
    startDate: '2025-01-12',
    endDate: '2025-01-18',
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].capacityDate, '2025-01-15');
});

test('listLaborCapacity filters by teamCode', async () => {
  const { service } = createServiceWithRepo();

  await service.createLaborCapacity(
    { capacityDate: '2025-01-15', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );
  await service.createLaborCapacity(
    { capacityDate: '2025-01-15', teamCode: 'TEAM-B', availableHours: 32 },
    defaultContext,
  );

  const records = await service.listLaborCapacity({ teamCode: 'TEAM-B' });
  assert.equal(records.length, 1);
  assert.equal(records[0].teamCode, 'TEAM-B');
  assert.equal(records[0].availableHours, 32);
});

test('listLaborCapacity shows allocated vs available', async () => {
  const { service } = createServiceWithRepo();

  const cap = await service.createLaborCapacity(
    { capacityDate: '2025-01-15', teamCode: 'TEAM-A', availableHours: 40 },
    defaultContext,
  );

  await service.allocateLaborHours(cap.id, 10, defaultContext);
  await service.allocateLaborHours(cap.id, 5, defaultContext);

  const records = await service.listLaborCapacity({ teamCode: 'TEAM-A' });
  assert.equal(records.length, 1);
  assert.equal(records[0].availableHours, 40);
  assert.equal(records[0].allocatedHours, 15);
});

// ─── Lambda Handler Tests ───────────────────────────────────────────────────

test('listBuildSlotsHandler returns 422 for invalid state', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: { state: 'INVALID_STATE' },
  };

  const response = await listBuildSlotsHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Invalid state'));
});

test('listBuildSlotsHandler returns 422 for invalid startDate', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: { startDate: 'not-a-date' },
  };

  const response = await listBuildSlotsHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.equal(body.message, 'startDate must be a valid ISO-8601 date.');
});

test('listBuildSlotsHandler returns 422 for invalid limit', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: { limit: '-5' },
  };

  const response = await listBuildSlotsHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.equal(body.message, 'limit must be a positive integer.');
});

test('listBuildSlotsHandler returns 200 with empty filters', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: {},
  };

  const response = await listBuildSlotsHandler(event);
  assert.equal(response.statusCode, 200);

  const body = parseResponseBody(response);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.limit, 50);
  assert.equal(body.offset, 0);
});

test('listLaborCapacityHandler returns 422 for invalid state', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: { state: 'BOGUS' },
  };

  const response = await listLaborCapacityHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Invalid state'));
});

test('listLaborCapacityHandler returns 200 with valid filters', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      state: 'OPEN',
      teamCode: 'TEAM-X',
      limit: '10',
      offset: '0',
    },
  };

  const response = await listLaborCapacityHandler(event);
  assert.equal(response.statusCode, 200);

  const body = parseResponseBody(response);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.limit, 10);
  assert.equal(body.offset, 0);
});

test('listLaborCapacityHandler returns 422 for invalid endDate', async () => {
  const event: ApiGatewayProxyEventLike = {
    queryStringParameters: { endDate: 'xyz' },
  };

  const response = await listLaborCapacityHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.equal(body.message, 'endDate must be a valid ISO-8601 date.');
});

// ─── Routes integration ─────────────────────────────────────────────────────

test('routes.listBuildSlots delegates to service correctly', async () => {
  const { routes, service } = createServiceWithRepo();

  await service.createBuildSlot(
    { slotDate: '2025-02-01', workstationCode: 'WS-C', capacityHours: 10 },
    defaultContext,
  );

  const slots = await routes.listBuildSlots({ workstationCode: 'WS-C' });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].workstationCode, 'WS-C');
  assert.equal(slots[0].capacityHours, 10);
});

test('routes.listLaborCapacity delegates to service correctly', async () => {
  const { routes, service } = createServiceWithRepo();

  await service.createLaborCapacity(
    { capacityDate: '2025-02-01', teamCode: 'TEAM-D', availableHours: 24 },
    defaultContext,
  );

  const caps = await routes.listLaborCapacity({ teamCode: 'TEAM-D' });
  assert.equal(caps.length, 1);
  assert.equal(caps[0].teamCode, 'TEAM-D');
  assert.equal(caps[0].availableHours, 24);
});
