import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  createTimeEntryHandler,
  deleteTimeEntryHandler,
  disconnectTicketHandlerDependencies,
  listTimeEntriesHandler,
  setTicketHandlerTimeEntryServiceForTests,
  updateTimeEntryHandler,
} from '../lambda/tickets/handlers.js';

after(async () => {
  setTicketHandlerTimeEntryServiceForTests(undefined);
  await disconnectTicketHandlerDependencies();
});

// ─── List ─────────────────────────────────────────────────────────────────────

test('listTimeEntriesHandler returns entries from the service', async () => {
  setTicketHandlerTimeEntryServiceForTests({
    async listEntries() {
      return [
        {
          id: 'entry-1',
          workOrderId: 'wo-1',
          technicianId: 'user-1',
          technicianTaskId: null,
          startedAt: new Date('2026-03-20T08:00:00.000Z'),
          endedAt: new Date('2026-03-20T10:00:00.000Z'),
          manualHours: null,
          description: 'Morning shift',
          source: 'MANUAL',
          createdAt: new Date('2026-03-20T08:00:00.000Z'),
          updatedAt: new Date('2026-03-20T10:00:00.000Z'),
          computedHours: 2,
        },
      ];
    },
    async createEntry() {
      throw new Error('should not be called');
    },
    async updateEntry() {
      throw new Error('should not be called');
    },
    async deleteEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await listTimeEntriesHandler({
      httpMethod: 'GET',
      queryStringParameters: { workOrderId: 'wo-1', technicianId: 'user-1' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      entries: Array<{
        id: string;
        workOrderId: string;
        technicianId: string;
        computedHours: number;
      }>;
    };

    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].id, 'entry-1');
    assert.equal(payload.entries[0].technicianId, 'user-1');
    assert.equal(payload.entries[0].computedHours, 2);
  } finally {
    setTicketHandlerTimeEntryServiceForTests(undefined);
  }
});

test('listTimeEntriesHandler returns 400 when workOrderId is missing', async () => {
  const response = await listTimeEntriesHandler({
    httpMethod: 'GET',
    queryStringParameters: {},
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'workOrderId is required.',
  );
});

// ─── Create ───────────────────────────────────────────────────────────────────

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

test('createTimeEntryHandler returns 400 for invalid JSON', async () => {
  const response = await createTimeEntryHandler({ body: '{bad-json' });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'Request body must be valid JSON.',
  );
});

test('createTimeEntryHandler returns 201 with mapped response', async () => {
  let capturedCorrelationId: string | undefined;

  setTicketHandlerTimeEntryServiceForTests({
    async listEntries() {
      return [];
    },
    async createEntry(input) {
      capturedCorrelationId = input.correlationId;
      return {
        id: 'entry-new',
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
      throw new Error('should not be called');
    },
    async deleteEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await createTimeEntryHandler({
      body: JSON.stringify({
        workOrderId: 'wo-1',
        technicianId: 'tech-1',
        startedAt: '2026-03-20T12:00:00.000Z',
        description: 'Started repair',
      }),
      headers: { 'x-correlation-id': 'corr-te-create' },
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      entry: {
        id: string;
        workOrderId: string;
        technicianId: string;
        description: string;
        computedHours: number;
      };
    };
    assert.equal(payload.entry.id, 'entry-new');
    assert.equal(payload.entry.workOrderId, 'wo-1');
    assert.equal(payload.entry.technicianId, 'tech-1');
    assert.equal(payload.entry.description, 'Started repair');
    assert.equal(capturedCorrelationId, 'corr-te-create');
  } finally {
    setTicketHandlerTimeEntryServiceForTests(undefined);
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

test('updateTimeEntryHandler returns 400 when ID is missing', async () => {
  const response = await updateTimeEntryHandler({
    body: JSON.stringify({ description: 'Updated' }),
    pathParameters: {},
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'Time entry ID is required.',
  );
});

test('updateTimeEntryHandler returns 200 with updated entry', async () => {
  setTicketHandlerTimeEntryServiceForTests({
    async listEntries() {
      return [];
    },
    async createEntry() {
      throw new Error('should not be called');
    },
    async updateEntry(_id, patch, _correlationId) {
      return {
        id: 'entry-1',
        workOrderId: 'wo-1',
        technicianId: 'user-1',
        technicianTaskId: null,
        startedAt: new Date('2026-03-20T08:00:00.000Z'),
        endedAt: patch.endedAt ? new Date(patch.endedAt) : null,
        manualHours: patch.manualHours != null ? new Prisma.Decimal(patch.manualHours) : null,
        description: patch.description ?? 'Original note',
        source: 'MANUAL',
        createdAt: new Date('2026-03-20T08:00:00.000Z'),
        updatedAt: new Date('2026-03-20T14:00:00.000Z'),
        computedHours: 6,
      };
    },
    async deleteEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await updateTimeEntryHandler({
      body: JSON.stringify({ endedAt: '2026-03-20T14:00:00.000Z' }),
      pathParameters: { id: 'entry-1' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      entry: { id: string; computedHours: number };
    };
    assert.equal(payload.entry.id, 'entry-1');
    assert.equal(payload.entry.computedHours, 6);
  } finally {
    setTicketHandlerTimeEntryServiceForTests(undefined);
  }
});

test('updateTimeEntryHandler returns 400 for invalid JSON body', async () => {
  const response = await updateTimeEntryHandler({
    pathParameters: { id: 'entry-1' },
    body: '{bad-json',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'Request body must be valid JSON.',
  );
});

// ─── Delete ───────────────────────────────────────────────────────────────────

test('deleteTimeEntryHandler returns 400 when ID is missing', async () => {
  const response = await deleteTimeEntryHandler({ pathParameters: {} });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'Time entry ID is required.',
  );
});

test('deleteTimeEntryHandler returns 204 on success', async () => {
  let deletedId: string | undefined;

  setTicketHandlerTimeEntryServiceForTests({
    async listEntries() {
      return [];
    },
    async createEntry() {
      throw new Error('should not be called');
    },
    async updateEntry() {
      throw new Error('should not be called');
    },
    async deleteEntry(id) {
      deletedId = id;
    },
  });

  try {
    const response = await deleteTimeEntryHandler({
      pathParameters: { id: 'entry-to-delete' },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(deletedId, 'entry-to-delete');
  } finally {
    setTicketHandlerTimeEntryServiceForTests(undefined);
  }
});
