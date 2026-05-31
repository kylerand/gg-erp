import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  cancelCapacitySlotHandler,
  createCapacitySlotHandler,
  getBuildSlotDemandProjectionHandler,
  getSchedulePreviewHandler,
  importCapacitySlotsHandler,
  listCapacitySlotsHandler,
  listBuildSlotsHandler,
  listLaborCapacityHandler,
  listScheduleAssignmentsHandler,
  publishScheduleHandler,
  setSchedulingCapacityStoreForTests,
  setSchedulingPublicationStoreForTests,
  setSchedulingProjectionQueriesForTests,
  updateCapacitySlotHandler,
  type ApiGatewayProxyEventLike,
  type CapacitySlotListInput,
  type CapacitySlotListResult,
  type CapacitySlotResponse,
  type CreateCapacitySlotInput,
  type ScheduleAssignmentListInput,
  type ScheduleAssignmentListResult,
  type ScheduleAssignmentResponse,
  type SchedulePublicationResult,
  type SchedulePreviewResult,
  type SchedulingCapacitySlotStore,
  type SchedulingPublicationStore,
  type UpdateCapacitySlotInput,
} from '../lambda/scheduling/handlers.js';
import { buildSlotDemandProjection } from '../contexts/build-planning/buildSlotProjection.js';

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

function createCapacityStoreForTests(): SchedulingCapacitySlotStore & {
  items: CapacitySlotResponse[];
} {
  const stockLocations = [
    {
      id: '00000000-0000-4000-8000-000000000111',
      locationCode: 'MAIN',
      locationName: 'Main Shop',
      locationType: 'WAREHOUSE',
    },
    {
      id: '00000000-0000-4000-8000-000000000112',
      locationCode: 'BAY-1',
      locationName: 'Bay 1',
      locationType: 'BAY',
    },
  ];
  const items: CapacitySlotResponse[] = [];
  let nextSlotNumber = 1;

  function makeItem(
    input: CreateCapacitySlotInput,
    id = `00000000-0000-4000-8000-${String(nextSlotNumber++).padStart(12, '0')}`,
  ): CapacitySlotResponse {
    const location = stockLocations.find((entry) => entry.id === input.stockLocationId);
    if (!location) throw new Error('stock location not found');
    return {
      id,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      date: input.slotStart.slice(0, 10),
      stockLocationId: location.id,
      stockLocationCode: location.locationCode,
      stockLocationName: location.locationName,
      stockLocationType: location.locationType,
      bayCode: input.bayCode,
      teamCode: input.teamCode,
      slotStatus: input.slotStatus ?? 'OPEN',
      capacityMinutes: input.capacityMinutes,
      allocatedMinutes: 0,
      remainingMinutes: input.capacityMinutes,
      createdAt: '2026-05-18T12:00:00.000Z',
      updatedAt: '2026-05-18T12:00:00.000Z',
      version: 0,
    };
  }

  const store: SchedulingCapacitySlotStore & { items: CapacitySlotResponse[] } = {
    items,
    async listCapacitySlots(input: CapacitySlotListInput): Promise<CapacitySlotListResult> {
      const filtered = items.filter((item) => {
        if (item.slotStart.slice(0, 10) < input.startDate) return false;
        if (item.slotStart.slice(0, 10) > input.endDate) return false;
        if (input.status && item.slotStatus !== input.status) return false;
        return true;
      });
      return {
        items: filtered.slice(input.offset, input.offset + input.limit),
        total: filtered.length,
        limit: input.limit,
        offset: input.offset,
        stockLocations,
      };
    },
    async createCapacitySlot(input) {
      if (items.some((item) =>
        item.stockLocationId === input.stockLocationId &&
        (item.bayCode ?? '') === (input.bayCode ?? '') &&
        item.slotStart === input.slotStart &&
        item.slotEnd === input.slotEnd
      )) {
        throw new Error('duplicate');
      }
      const item = makeItem(input);
      items.push(item);
      return item;
    },
    async updateCapacitySlot(id: string, input: UpdateCapacitySlotInput) {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1 || items[index].version !== input.expectedVersion) {
        throw new Error('version mismatch');
      }
      const next: CapacitySlotResponse = {
        ...items[index],
        slotStart: input.slotStart ?? items[index].slotStart,
        slotEnd: input.slotEnd ?? items[index].slotEnd,
        date: (input.slotStart ?? items[index].slotStart).slice(0, 10),
        stockLocationId: input.stockLocationId ?? items[index].stockLocationId,
        bayCode: 'bayCode' in input ? input.bayCode ?? undefined : items[index].bayCode,
        teamCode: 'teamCode' in input ? input.teamCode ?? undefined : items[index].teamCode,
        slotStatus: input.slotStatus ?? items[index].slotStatus,
        capacityMinutes: input.capacityMinutes ?? items[index].capacityMinutes,
        remainingMinutes: (input.capacityMinutes ?? items[index].capacityMinutes) - items[index].allocatedMinutes,
        version: items[index].version + 1,
        updatedAt: '2026-05-18T13:00:00.000Z',
      };
      items[index] = next;
      return next;
    },
    async cancelCapacitySlot(id: string, input) {
      return store.updateCapacitySlot(
        id,
        { expectedVersion: input.expectedVersion, slotStatus: 'CANCELLED' },
        { correlationId: 'test' },
      );
    },
    async upsertCapacitySlot(input) {
      const existing = items.find((item) =>
        item.stockLocationId === input.stockLocationId &&
        (item.bayCode ?? '') === (input.bayCode ?? '') &&
        item.slotStart === input.slotStart &&
        item.slotEnd === input.slotEnd
      );
      if (existing) {
        const item = await store.updateCapacitySlot(existing.id, {
          expectedVersion: existing.version,
          teamCode: input.teamCode,
          slotStatus: input.slotStatus ?? 'OPEN',
          capacityMinutes: input.capacityMinutes,
        }, { correlationId: 'test' });
        return { item, created: false };
      }
      const item = makeItem(input);
      items.push(item);
      return { item, created: true };
    },
  };
  return store;
}

function createPublicationStoreForTests(): SchedulingPublicationStore & {
  items: ScheduleAssignmentResponse[];
} {
  const items: ScheduleAssignmentResponse[] = [];

  return {
    items,
    async publishSchedule(input, preview): Promise<SchedulePublicationResult> {
      items.splice(
        0,
        items.length,
        ...preview.assignments.map((assignment, index): ScheduleAssignmentResponse => ({
          id: `assignment-${index + 1}`,
          plannerRunId: 'run-1',
          assignmentState: 'PUBLISHED',
          workOrderId: assignment.workOrderId,
          workOrderNumber: assignment.workOrderNumber,
          title: assignment.title,
          workOrderStatus: assignment.status,
          operationId: assignment.operationId,
          operationCode: assignment.operationCode,
          operationName: assignment.operationName,
          operationSequenceNo: assignment.operationSequenceNo,
          operationStatus: assignment.operationStatus,
          estimatedMinutes: assignment.estimatedMinutes,
          capacitySlotId: assignment.capacitySlotId,
          slotStart: assignment.slotStart,
          slotEnd: assignment.slotEnd,
          stockLocationId: assignment.stockLocationId ?? '00000000-0000-4000-8000-000000000111',
          stockLocationCode: 'MAIN',
          stockLocationName: 'Main Shop',
          bayCode: assignment.bayCode,
          teamCode: assignment.teamCode,
          plannedStartAt: assignment.plannedStartAt,
          plannedEndAt: assignment.plannedEndAt,
          slotSequenceNo: assignment.slotSequenceNo,
          createdAt: '2026-05-18T13:00:00.000Z',
          updatedAt: '2026-05-18T13:00:00.000Z',
        })),
      );

      return {
        run: {
          id: 'run-1',
          runStatus: 'SUCCEEDED',
          algorithmVersion: 'deterministic-slot-v1',
          inputHash: `${input.startDate}-${input.endDate}`,
          startedAt: '2026-05-18T13:00:00.000Z',
          completedAt: '2026-05-18T13:00:00.000Z',
          createdAt: '2026-05-18T13:00:00.000Z',
        },
        publishedAt: '2026-05-18T13:00:00.000Z',
        assignmentCount: preview.assignments.length,
        scheduledMinutes: preview.totals.scheduledMinutes,
        projection: preview.projection,
        assignments: items,
        totals: preview.totals,
        warnings: preview.warnings,
      };
    },
    async listScheduleAssignments(input: ScheduleAssignmentListInput): Promise<ScheduleAssignmentListResult> {
      const filtered = items.filter((item) => {
        if (item.plannedStartAt.slice(0, 10) < input.startDate) return false;
        if (item.plannedStartAt.slice(0, 10) > input.endDate) return false;
        if (input.state && item.assignmentState !== input.state) return false;
        return true;
      });
      return {
        items: filtered.slice(input.offset, input.offset + input.limit),
        total: filtered.length,
        limit: input.limit,
        offset: input.offset,
      };
    },
  };
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

// ─── Demand Projection Tests ────────────────────────────────────────────────

test('buildSlotDemandProjection schedules ready operations and reports overflow', () => {
  const projection = buildSlotDemandProjection({
    startDate: '2026-05-18',
    endDate: '2026-05-22',
    generatedAt: '2026-05-18T12:00:00.000Z',
    slots: [
      {
        slotId: 'slot-1',
        slotStart: '2026-05-18T13:00:00.000Z',
        slotEnd: '2026-05-18T21:00:00.000Z',
        bayCode: 'BAY-1',
        teamCode: 'BUILD',
        status: 'OPEN',
        capacityMinutes: 480,
        allocatedMinutes: 0,
      },
    ],
    demand: [
      {
        workOrderId: 'wo-1',
        workOrderNumber: 'WO-001',
        title: 'Lift kit build',
        status: 'READY',
        priority: 5,
        materialReadiness: 'READY',
        operationId: 'op-1',
        operationCode: 'BUILD-010',
        operationName: 'Install lift kit',
        sequenceNo: 10,
        operationStatus: 'READY',
        estimatedMinutes: 360,
      },
      {
        workOrderId: 'wo-2',
        workOrderNumber: 'WO-002',
        title: 'Lighting install',
        status: 'READY',
        priority: 3,
        materialReadiness: 'READY',
        operationId: 'op-2',
        operationCode: 'ELEC-010',
        operationName: 'Install lighting',
        sequenceNo: 10,
        operationStatus: 'READY',
        estimatedMinutes: 240,
      },
    ],
  });

  assert.equal(projection.source.capacitySource, 'planning.capacity_slots');
  assert.equal(projection.slots[0].demand.length, 1);
  assert.equal(projection.slots[0].demand[0].workOrderNumber, 'WO-001');
  assert.equal(projection.slots[0].projectedDemandMinutes, 360);
  assert.equal(projection.unscheduled.length, 1);
  assert.equal(projection.unscheduled[0].reason, 'OVER_CAPACITY');
  assert.equal(projection.totals.overCapacityMinutes, 120);
});

test('buildSlotDemandProjection keeps blocked and material-short operations out of slots', () => {
  const projection = buildSlotDemandProjection({
    startDate: '2026-05-18',
    endDate: '2026-05-22',
    generatedAt: '2026-05-18T12:00:00.000Z',
    slots: [
      {
        slotId: 'slot-1',
        slotStart: '2026-05-18T13:00:00.000Z',
        slotEnd: '2026-05-18T21:00:00.000Z',
        status: 'OPEN',
        capacityMinutes: 480,
        allocatedMinutes: 0,
      },
    ],
    demand: [
      {
        workOrderId: 'wo-1',
        workOrderNumber: 'WO-001',
        title: 'Blocked build',
        status: 'BLOCKED',
        priority: 5,
        materialReadiness: 'READY',
        operationId: 'op-1',
        operationCode: 'BUILD-010',
        operationName: 'Install kit',
        sequenceNo: 10,
        operationStatus: 'BLOCKED',
        estimatedMinutes: 120,
      },
      {
        workOrderId: 'wo-2',
        workOrderNumber: 'WO-002',
        title: 'Parts shortage',
        status: 'READY',
        priority: 4,
        materialReadiness: 'NOT_READY',
        operationId: 'op-2',
        operationCode: 'ELEC-010',
        operationName: 'Wire accessories',
        sequenceNo: 10,
        operationStatus: 'READY',
        estimatedMinutes: 120,
      },
    ],
  });

  assert.equal(projection.slots[0].demand.length, 0);
  assert.deepEqual(
    projection.unscheduled.map((item) => item.reason).sort(),
    ['MATERIAL_NOT_READY', 'OPERATION_BLOCKED'],
  );
  assert.equal(projection.totals.blockedByMaterialCount, 1);
  assert.equal(projection.totals.blockedOperationCount, 1);
});

test('getBuildSlotDemandProjectionHandler validates date range', async () => {
  const response = await getBuildSlotDemandProjectionHandler({
    queryStringParameters: { startDate: '2026-05-22', endDate: '2026-05-18' },
  });

  assert.equal(response.statusCode, 422);
  const body = parseResponseBody(response);
  assert.equal(body.message, 'startDate cannot be after endDate.');
});

test('getBuildSlotDemandProjectionHandler returns projection from live query contract', async () => {
  setSchedulingProjectionQueriesForTests({
    async listCapacitySlots() {
      return [
        {
          slotId: 'slot-1',
          slotStart: '2026-05-18T13:00:00.000Z',
          slotEnd: '2026-05-18T21:00:00.000Z',
          status: 'OPEN',
          capacityMinutes: 480,
          allocatedMinutes: 60,
        },
      ];
    },
    async listOperationDemand() {
      return [
        {
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-001',
          title: 'Lift kit build',
          status: 'READY',
          priority: 5,
          materialReadiness: 'READY',
          operationId: 'op-1',
          operationCode: 'BUILD-010',
          operationName: 'Install lift kit',
          sequenceNo: 10,
          operationStatus: 'READY',
          estimatedMinutes: 180,
        },
      ];
    },
  });

  try {
    const response = await getBuildSlotDemandProjectionHandler({
      queryStringParameters: { startDate: '2026-05-18', endDate: '2026-05-22' },
    });

    assert.equal(response.statusCode, 200);
    const body = parseResponseBody(response) as unknown as {
      totals: { scheduledCount: number; allocatedMinutes: number };
      slots: Array<{ demand: Array<{ workOrderNumber: string }> }>;
    };
    assert.equal(body.totals.scheduledCount, 1);
    assert.equal(body.totals.allocatedMinutes, 60);
    assert.equal(body.slots[0].demand[0].workOrderNumber, 'WO-001');
  } finally {
    setSchedulingProjectionQueriesForTests(undefined);
  }
});

test('capacity slot handlers create, list, update, and cancel persisted slots', async () => {
  const store = createCapacityStoreForTests();
  setSchedulingCapacityStoreForTests(store);

  try {
    const createResponse = await createCapacitySlotHandler({
      body: JSON.stringify({
        slotStart: '2026-05-18T13:00:00.000Z',
        slotEnd: '2026-05-18T21:00:00.000Z',
        stockLocationId: '00000000-0000-4000-8000-000000000111',
        bayCode: 'BAY-1',
        teamCode: 'BUILD',
        capacityMinutes: 480,
      }),
      headers: { 'x-correlation-id': 'capacity-test-1' },
    });
    assert.equal(createResponse.statusCode, 201);

    const listResponse = await listCapacitySlotsHandler({
      queryStringParameters: { startDate: '2026-05-18', endDate: '2026-05-22' },
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = parseResponseBody(listResponse) as unknown as CapacitySlotListResult;
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.stockLocations[0].locationCode, 'MAIN');

    const updateResponse = await updateCapacitySlotHandler({
      pathParameters: { id: listBody.items[0].id },
      body: JSON.stringify({ expectedVersion: 0, capacityMinutes: 540 }),
      headers: { 'x-correlation-id': 'capacity-test-2' },
    });
    assert.equal(updateResponse.statusCode, 200);
    const updateBody = parseResponseBody(updateResponse) as unknown as { item: CapacitySlotResponse };
    assert.equal(updateBody.item.capacityMinutes, 540);
    assert.equal(updateBody.item.version, 1);

    const cancelResponse = await cancelCapacitySlotHandler({
      pathParameters: { id: updateBody.item.id },
      body: JSON.stringify({ expectedVersion: 1 }),
      headers: { 'x-correlation-id': 'capacity-test-3' },
    });
    assert.equal(cancelResponse.statusCode, 200);
    const cancelBody = parseResponseBody(cancelResponse) as unknown as { item: CapacitySlotResponse };
    assert.equal(cancelBody.item.slotStatus, 'CANCELLED');
  } finally {
    setSchedulingCapacityStoreForTests(undefined);
  }
});

test('importCapacitySlotsHandler upserts rows and returns refreshed projection', async () => {
  const store = createCapacityStoreForTests();
  setSchedulingCapacityStoreForTests(store);
  setSchedulingProjectionQueriesForTests({
    async listCapacitySlots() {
      throw new Error('capacity should come from capacity store override');
    },
    async listOperationDemand() {
      return [
        {
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-001',
          title: 'Lift kit build',
          status: 'READY',
          priority: 5,
          materialReadiness: 'READY',
          operationId: 'op-1',
          operationCode: 'BUILD-010',
          operationName: 'Install lift kit',
          sequenceNo: 10,
          operationStatus: 'READY',
          estimatedMinutes: 180,
        },
      ];
    },
  });

  try {
    const response = await importCapacitySlotsHandler({
      body: JSON.stringify({
        startDate: '2026-05-18',
        endDate: '2026-05-22',
        rows: [
          {
            rowNumber: 2,
            date: '2026-05-18',
            startTime: '08:00',
            endTime: '16:00',
            locationCode: 'MAIN',
            bayCode: 'BAY-1',
            teamCode: 'BUILD',
            capacityHours: 8,
          },
          {
            rowNumber: 3,
            date: '2026-05-18',
            startTime: '08:00',
            endTime: '16:00',
            locationCode: 'MAIN',
            bayCode: 'BAY-1',
            teamCode: 'BUILD',
            capacityHours: 8,
          },
        ],
      }),
      headers: { 'x-correlation-id': 'capacity-import-test' },
    });

    assert.equal(response.statusCode, 200);
    const body = parseResponseBody(response) as unknown as {
      imported: number;
      updated: number;
      skipped: number;
      errors: Array<{ rowNumber: number; message: string }>;
      projection: { totals: { scheduledCount: number; capacityMinutes: number } };
    };
    assert.equal(body.imported, 1);
    assert.equal(body.updated, 0);
    assert.equal(body.skipped, 1);
    assert.equal(body.errors[0].rowNumber, 3);
    assert.equal(body.projection.totals.scheduledCount, 1);
    assert.equal(body.projection.totals.capacityMinutes, 480);
  } finally {
    setSchedulingCapacityStoreForTests(undefined);
    setSchedulingProjectionQueriesForTests(undefined);
  }
});

test('capacity slot import validates body shape', async () => {
  const response = await importCapacitySlotsHandler({
    body: JSON.stringify({ rows: [] }),
  });
  assert.equal(response.statusCode, 422);
  const body = parseResponseBody(response);
  assert.equal(body.message, 'At least one capacity row is required.');
});

test('schedule preview turns projected demand into sequential planned assignments', async () => {
  const store = createCapacityStoreForTests();
  setSchedulingCapacityStoreForTests(store);
  setSchedulingProjectionQueriesForTests({
    async listCapacitySlots() {
      throw new Error('capacity should come from capacity store override');
    },
    async listOperationDemand() {
      return [
        {
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-001',
          title: 'Lift kit build',
          status: 'READY',
          priority: 5,
          materialReadiness: 'READY',
          operationId: 'op-1',
          operationCode: 'BUILD-010',
          operationName: 'Install lift kit',
          sequenceNo: 10,
          operationStatus: 'READY',
          estimatedMinutes: 60,
        },
        {
          workOrderId: 'wo-1',
          workOrderNumber: 'WO-001',
          title: 'Lift kit build',
          status: 'READY',
          priority: 5,
          materialReadiness: 'READY',
          operationId: 'op-2',
          operationCode: 'BUILD-020',
          operationName: 'Torque suspension',
          sequenceNo: 20,
          operationStatus: 'READY',
          estimatedMinutes: 90,
        },
      ];
    },
  });

  try {
    const slot = await store.createCapacitySlot({
      slotStart: '2026-05-18T13:00:00.000Z',
      slotEnd: '2026-05-18T16:00:00.000Z',
      stockLocationId: '00000000-0000-4000-8000-000000000111',
      bayCode: 'BAY-1',
      teamCode: 'BUILD',
      capacityMinutes: 180,
    }, { correlationId: 'schedule-preview-test' });
    store.items[0] = {
      ...slot,
      allocatedMinutes: 30,
      remainingMinutes: 150,
    };

    const response = await getSchedulePreviewHandler({
      queryStringParameters: { startDate: '2026-05-18', endDate: '2026-05-18' },
    });

    assert.equal(response.statusCode, 200);
    const body = parseResponseBody(response) as unknown as SchedulePreviewResult;
    assert.equal(body.totals.assignmentCount, 2);
    assert.equal(body.totals.scheduledMinutes, 150);
    assert.equal(body.assignments[0].plannedStartAt, '2026-05-18T13:30:00.000Z');
    assert.equal(body.assignments[0].plannedEndAt, '2026-05-18T14:30:00.000Z');
    assert.equal(body.assignments[1].plannedStartAt, '2026-05-18T14:30:00.000Z');
    assert.equal(body.assignments[1].plannedEndAt, '2026-05-18T16:00:00.000Z');
  } finally {
    setSchedulingCapacityStoreForTests(undefined);
    setSchedulingProjectionQueriesForTests(undefined);
  }
});

test('publishScheduleHandler persists preview assignments through publication store', async () => {
  const capacityStore = createCapacityStoreForTests();
  const publicationStore = createPublicationStoreForTests();
  setSchedulingCapacityStoreForTests(capacityStore);
  setSchedulingPublicationStoreForTests(publicationStore);
  setSchedulingProjectionQueriesForTests({
    async listCapacitySlots() {
      throw new Error('capacity should come from capacity store override');
    },
    async listOperationDemand() {
      return [
        {
          workOrderId: 'wo-2',
          workOrderNumber: 'WO-002',
          title: 'Alignment',
          status: 'READY',
          priority: 4,
          materialReadiness: 'READY',
          operationId: 'op-3',
          operationCode: 'BUILD-030',
          operationName: 'Final alignment',
          sequenceNo: 30,
          operationStatus: 'PENDING',
          estimatedMinutes: 120,
        },
      ];
    },
  });

  try {
    await capacityStore.createCapacitySlot({
      slotStart: '2026-05-19T13:00:00.000Z',
      slotEnd: '2026-05-19T17:00:00.000Z',
      stockLocationId: '00000000-0000-4000-8000-000000000111',
      bayCode: 'BAY-2',
      teamCode: 'BUILD',
      capacityMinutes: 240,
    }, { correlationId: 'schedule-publish-test' });

    const response = await publishScheduleHandler({
      body: JSON.stringify({ startDate: '2026-05-19', endDate: '2026-05-19' }),
      headers: { 'x-correlation-id': 'schedule-publish-test' },
    });

    assert.equal(response.statusCode, 201);
    const body = parseResponseBody(response) as unknown as SchedulePublicationResult;
    assert.equal(body.assignmentCount, 1);
    assert.equal(body.assignments[0].assignmentState, 'PUBLISHED');
    assert.equal(publicationStore.items[0].operationId, 'op-3');

    const listResponse = await listScheduleAssignmentsHandler({
      queryStringParameters: { startDate: '2026-05-19', endDate: '2026-05-19', state: 'PUBLISHED' },
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = parseResponseBody(listResponse) as unknown as ScheduleAssignmentListResult;
    assert.equal(listBody.total, 1);
  } finally {
    setSchedulingCapacityStoreForTests(undefined);
    setSchedulingPublicationStoreForTests(undefined);
    setSchedulingProjectionQueriesForTests(undefined);
  }
});

test('publishScheduleHandler rejects empty schedule publications', async () => {
  const capacityStore = createCapacityStoreForTests();
  setSchedulingCapacityStoreForTests(capacityStore);
  setSchedulingProjectionQueriesForTests({
    async listCapacitySlots() {
      throw new Error('capacity should come from capacity store override');
    },
    async listOperationDemand() {
      return [
        {
          workOrderId: 'wo-3',
          workOrderNumber: 'WO-003',
          title: 'Material blocked build',
          status: 'READY',
          priority: 3,
          materialReadiness: 'NOT_READY',
          operationId: 'op-4',
          operationCode: 'BUILD-040',
          operationName: 'Install wheels',
          sequenceNo: 40,
          operationStatus: 'READY',
          estimatedMinutes: 60,
        },
      ];
    },
  });

  try {
    const response = await publishScheduleHandler({
      body: JSON.stringify({ startDate: '2026-05-20', endDate: '2026-05-20' }),
    });
    assert.equal(response.statusCode, 409);
    const body = parseResponseBody(response);
    assert.equal(body.message, 'No schedulable operations fit the selected capacity window.');
  } finally {
    setSchedulingCapacityStoreForTests(undefined);
    setSchedulingProjectionQueriesForTests(undefined);
  }
});

test('demand projection and schedule publication are wired into lambda build and terraform route discovery', () => {
  const tf = readFileSync(
    new URL('../../../../infra/terraform/modules/api-gateway-lambda/main.tf', import.meta.url),
    'utf8',
  );
  const buildScript = readFileSync(
    new URL('../../../../scripts/build-lambdas.ts', import.meta.url),
    'utf8',
  );

  assert.match(tf, /route_key\s+=\s+"GET \/scheduling\/demand-projection"/);
  assert.match(tf, /aws_lambda_function" "scheduling_demand_projection"/);
  assert.match(buildScript, /demand-projection\.handler\.ts/);
  assert.match(tf, /route_key\s+=\s+"GET \/scheduling\/capacity-slots"/);
  assert.match(tf, /route_key\s+=\s+"POST \/scheduling\/capacity-slots\/import"/);
  assert.match(buildScript, /import-capacity-slots\.handler\.ts/);
  assert.match(tf, /route_key\s+=\s+"GET \/scheduling\/schedule-preview"/);
  assert.match(tf, /route_key\s+=\s+"POST \/scheduling\/schedule-publications"/);
  assert.match(tf, /route_key\s+=\s+"GET \/scheduling\/schedule-assignments"/);
  assert.match(buildScript, /schedule-preview\.handler\.ts/);
  assert.match(buildScript, /publish-schedule\.handler\.ts/);
  assert.match(buildScript, /list-schedule-assignments\.handler\.ts/);
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
