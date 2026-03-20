import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  createReworkHandler,
  createTaskHandler,
  createTimeEntryHandler,
  deleteTimeEntryHandler,
  disconnectTicketHandlerDependencies,
  setTicketHandlerTimeEntryServiceForTests,
  transitionTaskHandler,
  updateTimeEntryHandler,
} from '../lambda/tickets/handlers.js';

after(async () => {
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
  assert.equal(
    (JSON.parse(missingId.body) as { message: string }).message,
    'Task ID is required.',
  );

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
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'title is required.',
  );
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