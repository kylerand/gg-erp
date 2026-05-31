import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  createReworkHandler,
  createTaskHandler,
  createTimeEntryHandler,
  deleteTimeEntryHandler,
  disconnectTicketHandlerDependencies,
  listTasksHandler,
  setTicketHandlerPrismaForTests,
  setTicketHandlerTimeEntryServiceForTests,
  transitionTaskHandler,
  transitionWoOperationHandler,
  updateTimeEntryHandler,
} from '../lambda/tickets/handlers.js';

after(async () => {
  setTicketHandlerPrismaForTests(undefined);
  setTicketHandlerTimeEntryServiceForTests(undefined);
  await disconnectTicketHandlerDependencies();
});

test('createTaskHandler returns 400 for invalid JSON', async () => {
  const response = await createTaskHandler({
    body: '{invalid-json',
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body) as { message: string };
  assert.equal(payload.message, 'Request body must be valid JSON.');
});

test('createTaskHandler returns 422 when required fields are missing', async () => {
  const missingWorkOrder = await createTaskHandler({
    body: JSON.stringify({ routingStepId: 'step-1' }),
  });
  assert.equal(missingWorkOrder.statusCode, 422);
  assert.equal(
    (JSON.parse(missingWorkOrder.body) as { message: string }).message,
    'workOrderId is required.',
  );

  const missingRoutingStep = await createTaskHandler({
    body: JSON.stringify({ workOrderId: 'wo-1' }),
  });
  assert.equal(missingRoutingStep.statusCode, 422);
  assert.equal(
    (JSON.parse(missingRoutingStep.body) as { message: string }).message,
    'routingStepId is required.',
  );
});

test('transitionTaskHandler returns identifier and body validation errors before DB access', async () => {
  const missingId = await transitionTaskHandler({
    body: JSON.stringify({ state: 'IN_PROGRESS' }),
    pathParameters: {},
  });
  assert.equal(missingId.statusCode, 400);
  assert.equal((JSON.parse(missingId.body) as { message: string }).message, 'Task ID is required.');

  const invalidJson = await transitionTaskHandler({
    body: '{invalid-json',
    pathParameters: { id: 'task-1' },
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.equal(
    (JSON.parse(invalidJson.body) as { message: string }).message,
    'Request body must be valid JSON.',
  );

  const missingState = await transitionTaskHandler({
    body: JSON.stringify({}),
    pathParameters: { id: 'task-1' },
  });
  assert.equal(missingState.statusCode, 422);
  assert.equal(
    (JSON.parse(missingState.body) as { message: string }).message,
    'state is required.',
  );
});

test('transitionTaskHandler rejects invalid technician assignment input', async () => {
  const response = await transitionTaskHandler({
    body: JSON.stringify({ state: 'READY', technicianId: 'emp-1' }),
    pathParameters: { id: '00000000-0000-4000-8000-000000000301' },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'technicianId must be a valid UUID.',
  );
});

test('transitionTaskHandler rejects starting an unassigned technician task', async () => {
  const TASK_ID = '00000000-0000-4000-8000-000000000301';
  const updatedAt = new Date('2026-05-31T12:00:00.000Z');

  setTicketHandlerPrismaForTests({
    technicianTask: {
      async findUnique(args: { where: { id: string } }) {
        assert.equal(args.where.id, TASK_ID);
        return {
          id: TASK_ID,
          workOrderId: '00000000-0000-4000-8000-000000000302',
          routingStepId: '00000000-0000-4000-8000-000000000303',
          technicianId: null,
          state: 'READY',
          startedAt: null,
          completedAt: null,
          blockedReason: null,
          updatedAt,
        };
      },
      async update() {
        throw new Error('update should not run for unassigned start');
      },
    },
  } as unknown as Partial<PrismaClient>);

  try {
    const response = await transitionTaskHandler({
      body: JSON.stringify({ state: 'IN_PROGRESS' }),
      pathParameters: { id: TASK_ID },
    });

    assert.equal(response.statusCode, 409);
    const payload = JSON.parse(response.body) as { message: string; requiredAction: string };
    assert.equal(payload.message, 'Assign a technician before starting this task.');
    assert.equal(payload.requiredAction, 'ASSIGN_TECHNICIAN');
  } finally {
    setTicketHandlerPrismaForTests(undefined);
  }
});

test('transitionTaskHandler can assign and start a technician task atomically', async () => {
  const TASK_ID = '00000000-0000-4000-8000-000000000311';
  const TECHNICIAN_ID = '00000000-0000-4000-8000-000000000312';
  const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000313';
  const STEP_ID = '00000000-0000-4000-8000-000000000314';
  const updatedAt = new Date('2026-05-31T12:00:00.000Z');

  setTicketHandlerPrismaForTests({
    technicianTask: {
      async findUnique() {
        return {
          id: TASK_ID,
          workOrderId: WORK_ORDER_ID,
          routingStepId: STEP_ID,
          technicianId: null,
          state: 'READY',
          startedAt: null,
          completedAt: null,
          blockedReason: null,
          updatedAt,
        };
      },
      async update(args: {
        where: { id: string };
        data: {
          state: string;
          technicianId?: string;
          startedAt?: Date;
          updatedAt: Date;
        };
      }) {
        assert.equal(args.where.id, TASK_ID);
        assert.equal(args.data.state, 'IN_PROGRESS');
        assert.equal(args.data.technicianId, TECHNICIAN_ID);
        assert.ok(args.data.startedAt instanceof Date);
        return {
          id: TASK_ID,
          workOrderId: WORK_ORDER_ID,
          routingStepId: STEP_ID,
          technicianId: TECHNICIAN_ID,
          state: 'IN_PROGRESS',
          startedAt: args.data.startedAt,
          completedAt: null,
          blockedReason: null,
          updatedAt: args.data.updatedAt,
        };
      },
    },
  } as unknown as Partial<PrismaClient>);

  try {
    const response = await transitionTaskHandler({
      body: JSON.stringify({ state: 'IN_PROGRESS', technicianId: TECHNICIAN_ID }),
      pathParameters: { id: TASK_ID },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      task: { id: string; technicianId?: string; state: string; startedAt?: string };
    };
    assert.equal(payload.task.id, TASK_ID);
    assert.equal(payload.task.technicianId, TECHNICIAN_ID);
    assert.equal(payload.task.state, 'IN_PROGRESS');
    assert.ok(payload.task.startedAt);
  } finally {
    setTicketHandlerPrismaForTests(undefined);
  }
});

test('listTasksHandler enriches technician tasks with work-order and routing-step context', async () => {
  const TASK_ID = '00000000-0000-4000-8000-000000000201';
  const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000202';
  const STEP_ID = '00000000-0000-4000-8000-000000000203';
  const TECHNICIAN_ID = '00000000-0000-4000-8000-000000000204';
  const updatedAt = new Date('2026-05-31T12:00:00.000Z');

  setTicketHandlerPrismaForTests({
    technicianTask: {
      async findMany(args: {
        where: { technicianId?: string };
        orderBy: { updatedAt: 'desc' };
        take: number;
      }) {
        assert.equal(args.where.technicianId, TECHNICIAN_ID);
        assert.equal(args.take, 20);
        return [
          {
            id: TASK_ID,
            workOrderId: WORK_ORDER_ID,
            routingStepId: STEP_ID,
            technicianId: TECHNICIAN_ID,
            state: 'READY',
            startedAt: null,
            completedAt: null,
            blockedReason: null,
            updatedAt,
          },
        ];
      },
    },
    woOrder: {
      async findMany(args: {
        where: { id: { in: string[] } };
        select: { id: true; workOrderNumber: true; title: true };
      }) {
        assert.deepEqual(args.where.id.in, [WORK_ORDER_ID]);
        assert.deepEqual(args.select, { id: true, workOrderNumber: true, title: true });
        return [{ id: WORK_ORDER_ID, workOrderNumber: 'WO-200', title: 'Lift install' }];
      },
    },
    routingSopStep: {
      async findMany(args: {
        where: { id: { in: string[] } };
        select: { id: true; stepName: true; stepCode: true; sequenceNo: true };
      }) {
        assert.deepEqual(args.where.id.in, [STEP_ID]);
        assert.deepEqual(args.select, {
          id: true,
          stepName: true,
          stepCode: true,
          sequenceNo: true,
        });
        return [
          {
            id: STEP_ID,
            stepName: 'Install lift kit',
            stepCode: 'LIFT-010',
            sequenceNo: 10,
          },
        ];
      },
    },
  } as unknown as Partial<PrismaClient>);

  try {
    const response = await listTasksHandler({
      queryStringParameters: { technicianId: TECHNICIAN_ID, limit: '20' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        workOrderNumber?: string;
        workOrderTitle?: string;
        routingStepTitle?: string;
        routingStepCode?: string;
      }>;
    };
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].id, TASK_ID);
    assert.equal(payload.items[0].workOrderNumber, 'WO-200');
    assert.equal(payload.items[0].workOrderTitle, 'Lift install');
    assert.equal(payload.items[0].routingStepTitle, '10. Install lift kit');
    assert.equal(payload.items[0].routingStepCode, 'LIFT-010');
  } finally {
    setTicketHandlerPrismaForTests(undefined);
  }
});

test('transitionWoOperationHandler validates identifiers and operation status input', async () => {
  const missingWorkOrder = await transitionWoOperationHandler({
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
    pathParameters: { operationId: 'operation-1' },
  });
  assert.equal(missingWorkOrder.statusCode, 400);
  assert.equal(
    (JSON.parse(missingWorkOrder.body) as { message: string }).message,
    'Work order ID is required.',
  );

  const missingOperation = await transitionWoOperationHandler({
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
    pathParameters: { workOrderId: 'work-order-1' },
  });
  assert.equal(missingOperation.statusCode, 400);
  assert.equal(
    (JSON.parse(missingOperation.body) as { message: string }).message,
    'Operation ID is required.',
  );

  const invalidJson = await transitionWoOperationHandler({
    body: '{invalid-json',
    pathParameters: { workOrderId: 'work-order-1', operationId: 'operation-1' },
  });
  assert.equal(invalidJson.statusCode, 400);

  const missingStatus = await transitionWoOperationHandler({
    body: JSON.stringify({}),
    pathParameters: { workOrderId: 'work-order-1', operationId: 'operation-1' },
  });
  assert.equal(missingStatus.statusCode, 422);
  assert.equal(
    (JSON.parse(missingStatus.body) as { message: string }).message,
    'status is required.',
  );

  const blockedWithoutReason = await transitionWoOperationHandler({
    body: JSON.stringify({ status: 'BLOCKED' }),
    pathParameters: { workOrderId: 'work-order-1', operationId: 'operation-1' },
  });
  assert.equal(blockedWithoutReason.statusCode, 422);
  assert.equal(
    (JSON.parse(blockedWithoutReason.body) as { message: string }).message,
    'blockingReason is required when blocking an operation.',
  );
});

test('transitionWoOperationHandler updates operation status and parent work-order activity', async () => {
  const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000101';
  const OPERATION_ID = '00000000-0000-4000-8000-000000000102';
  const ACTOR_ID = '00000000-0000-4000-8000-000000000103';
  const updatedAt = new Date('2026-05-18T12:00:00.000Z');
  let operationStatus = 'READY';
  let workOrderStatus = 'READY';
  const historyCreates: Array<{
    workOrderId: string;
    fromStatus: string;
    toStatus: string;
    reasonCode: string;
    actorUserId?: string;
    correlationId: string;
  }> = [];

  setTicketHandlerPrismaForTests({
    woOperation: {
      async findUnique() {
        return {
          id: OPERATION_ID,
          workOrderId: WORK_ORDER_ID,
          operationCode: 'BUILD-010',
          sequenceNo: 10,
          operationName: 'Install lift kit',
          operationStatus,
          requiredSkillCode: 'MECHANICAL',
          estimatedMinutes: 60,
          actualStartAt: null,
          actualEndAt: null,
          blockingReason: null,
          updatedAt,
          workOrder: {
            id: WORK_ORDER_ID,
            status: workOrderStatus,
            completedAt: null,
            updatedAt,
          },
        };
      },
      async update(args: { data: { operationStatus: string; actualStartAt?: Date } }) {
        operationStatus = args.data.operationStatus;
        return {
          id: OPERATION_ID,
          workOrderId: WORK_ORDER_ID,
          operationCode: 'BUILD-010',
          sequenceNo: 10,
          operationName: 'Install lift kit',
          operationStatus,
          requiredSkillCode: 'MECHANICAL',
          estimatedMinutes: 60,
          actualStartAt: args.data.actualStartAt ?? null,
          actualEndAt: null,
          blockingReason: null,
          updatedAt,
        };
      },
      async findMany() {
        return [{ operationStatus }, { operationStatus: 'DONE' }];
      },
    },
    woOrder: {
      async update(args: { data: { status: string; completedAt?: Date; updatedAt: Date } }) {
        workOrderStatus = args.data.status;
        return {
          id: WORK_ORDER_ID,
          status: workOrderStatus,
          completedAt: args.data.completedAt ?? null,
          updatedAt: args.data.updatedAt,
        };
      },
    },
    woStatusHistory: {
      async create(args: { data: (typeof historyCreates)[number] }) {
        historyCreates.push(args.data);
        return args.data;
      },
    },
  } as unknown as Partial<PrismaClient>);

  try {
    const response = await transitionWoOperationHandler({
      body: JSON.stringify({
        status: 'IN_PROGRESS',
        actorUserId: ACTOR_ID,
      }),
      headers: { 'x-correlation-id': 'operation-transition-correlation' },
      pathParameters: { workOrderId: WORK_ORDER_ID, operationId: OPERATION_ID },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      operation: { id: string; status: string; actualStartAt?: string };
      workOrder: { id: string; status: string };
    };

    assert.equal(payload.operation.id, OPERATION_ID);
    assert.equal(payload.operation.status, 'IN_PROGRESS');
    assert.ok(payload.operation.actualStartAt);
    assert.equal(payload.workOrder.id, WORK_ORDER_ID);
    assert.equal(payload.workOrder.status, 'IN_PROGRESS');
    assert.equal(historyCreates.length, 1);
    assert.equal(historyCreates[0].fromStatus, 'READY');
    assert.equal(historyCreates[0].toStatus, 'IN_PROGRESS');
    assert.equal(historyCreates[0].reasonCode, 'OPERATION_IN_PROGRESS');
    assert.equal(historyCreates[0].actorUserId, ACTOR_ID);
    assert.equal(historyCreates[0].correlationId, 'operation-transition-correlation');
  } finally {
    setTicketHandlerPrismaForTests(undefined);
  }
});

test('createReworkHandler returns 422 for missing contract fields', async () => {
  const response = await createReworkHandler({
    body: JSON.stringify({
      workOrderId: 'wo-1',
      title: '  ',
      description: '',
      severity: '',
      reportedBy: '',
    }),
  });

  assert.equal(response.statusCode, 422);
  assert.equal((JSON.parse(response.body) as { message: string }).message, 'title is required.');
});

test('createTimeEntryHandler returns 422 when required fields are missing', async () => {
  const missingWorkOrder = await createTimeEntryHandler({
    body: JSON.stringify({ technicianId: 'tech-1', startedAt: '2026-03-20T12:00:00.000Z' }),
  });
  assert.equal(missingWorkOrder.statusCode, 422);
  assert.equal(
    (JSON.parse(missingWorkOrder.body) as { message: string }).message,
    'workOrderId is required.',
  );

  const missingTechnician = await createTimeEntryHandler({
    body: JSON.stringify({ workOrderId: 'wo-1', startedAt: '2026-03-20T12:00:00.000Z' }),
  });
  assert.equal(missingTechnician.statusCode, 422);
  assert.equal(
    (JSON.parse(missingTechnician.body) as { message: string }).message,
    'technicianId is required.',
  );

  const missingStartedAt = await createTimeEntryHandler({
    body: JSON.stringify({ workOrderId: 'wo-1', technicianId: 'tech-1' }),
  });
  assert.equal(missingStartedAt.statusCode, 422);
  assert.equal(
    (JSON.parse(missingStartedAt.body) as { message: string }).message,
    'startedAt is required.',
  );
});

test('createTimeEntryHandler returns 201 with the service response payload', async () => {
  let capturedCorrelationId: string | undefined;

  setTicketHandlerTimeEntryServiceForTests({
    async listEntries() {
      return [];
    },
    async createEntry(input) {
      capturedCorrelationId = input.correlationId;
      return {
        id: 'entry-1',
        workOrderId: input.workOrderId,
        technicianId: input.technicianId,
        technicianTaskId: input.technicianTaskId ?? null,
        startedAt: new Date(input.startedAt),
        endedAt: null,
        manualHours: null,
        description: input.description ?? null,
        source: input.source ?? 'MANUAL',
        createdAt: new Date('2026-03-20T12:00:00.000Z'),
        updatedAt: new Date('2026-03-20T12:00:00.000Z'),
        computedHours: 0,
      };
    },
    async updateEntry() {
      throw new Error('updateEntry should not be called in this test');
    },
    async deleteEntry() {
      throw new Error('deleteEntry should not be called in this test');
    },
  });

  try {
    const response = await createTimeEntryHandler({
      body: JSON.stringify({
        workOrderId: 'wo-1',
        technicianId: 'tech-1',
        technicianTaskId: 'task-1',
        startedAt: '2026-03-20T12:00:00.000Z',
        description: 'Initial diagnosis',
      }),
      headers: { 'x-correlation-id': 'corr-ticket-mutation' },
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      entry: {
        id: string;
        workOrderId: string;
        technicianId: string;
        technicianTaskId: string;
        description: string;
        computedHours: number;
      };
    };
    assert.equal(payload.entry.id, 'entry-1');
    assert.equal(payload.entry.workOrderId, 'wo-1');
    assert.equal(payload.entry.technicianTaskId, 'task-1');
    assert.equal(payload.entry.description, 'Initial diagnosis');
    assert.equal(payload.entry.computedHours, 0);
    assert.equal(capturedCorrelationId, 'corr-ticket-mutation');
  } finally {
    setTicketHandlerTimeEntryServiceForTests(undefined);
  }
});

test('time-entry mutation handlers require an entry identifier', async () => {
  const updateResponse = await updateTimeEntryHandler({
    body: JSON.stringify({ description: 'Updated note' }),
    pathParameters: {},
  });
  assert.equal(updateResponse.statusCode, 400);
  assert.equal(
    (JSON.parse(updateResponse.body) as { message: string }).message,
    'Time entry ID is required.',
  );

  const deleteResponse = await deleteTimeEntryHandler({
    pathParameters: {},
  });
  assert.equal(deleteResponse.statusCode, 400);
  assert.equal(
    (JSON.parse(deleteResponse.body) as { message: string }).message,
    'Time entry ID is required.',
  );
});
