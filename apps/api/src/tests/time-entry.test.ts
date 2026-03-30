import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  createTimeEntryHandler,
  deleteTimeEntryHandler,
  disconnectTimeEntryDependencies,
  listTimeEntriesHandler,
  setTimeEntryServiceForTests,
  updateTimeEntryHandler,
} from '../lambda/time-entries/handlers.js';

after(async () => {
  setTimeEntryServiceForTests(undefined);
  await disconnectTimeEntryDependencies();
});

// ─── List ─────────────────────────────────────────────────────────────────────

test('listTimeEntriesHandler returns entries from the service', async () => {
  setTimeEntryServiceForTests({
    async listTimeEntries() {
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
    async createTimeEntry() {
      throw new Error('should not be called');
    },
    async updateTimeEntry() {
      throw new Error('should not be called');
    },
    async deleteTimeEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await listTimeEntriesHandler({
      httpMethod: 'GET',
      queryStringParameters: { workOrderId: 'wo-1', userId: 'user-1' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      entries: Array<{
        id: string;
        workOrderId: string;
        userId: string;
        startTime: string;
        endTime: string;
        notes: string;
        computedHours: number;
      }>;
    };

    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].id, 'entry-1');
    assert.equal(payload.entries[0].userId, 'user-1');
    assert.equal(payload.entries[0].startTime, '2026-03-20T08:00:00.000Z');
    assert.equal(payload.entries[0].endTime, '2026-03-20T10:00:00.000Z');
    assert.equal(payload.entries[0].notes, 'Morning shift');
    assert.equal(payload.entries[0].computedHours, 2);
  } finally {
    setTimeEntryServiceForTests(undefined);
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

test('createTimeEntryHandler returns 422 when required fields are missing', async () => {
  const missingWorkOrder = await createTimeEntryHandler({
    body: JSON.stringify({ userId: 'user-1', startTime: '2026-03-20T12:00:00.000Z' }),
  });
  assert.equal(missingWorkOrder.statusCode, 422);
  assert.equal(
    (JSON.parse(missingWorkOrder.body) as { message: string }).message,
    'workOrderId is required.',
  );

  const missingUser = await createTimeEntryHandler({
    body: JSON.stringify({ workOrderId: 'wo-1', startTime: '2026-03-20T12:00:00.000Z' }),
  });
  assert.equal(missingUser.statusCode, 422);
  assert.equal(
    (JSON.parse(missingUser.body) as { message: string }).message,
    'userId is required.',
  );

  const missingStartTime = await createTimeEntryHandler({
    body: JSON.stringify({ workOrderId: 'wo-1', userId: 'user-1' }),
  });
  assert.equal(missingStartTime.statusCode, 422);
  assert.equal(
    (JSON.parse(missingStartTime.body) as { message: string }).message,
    'startTime is required.',
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

  setTimeEntryServiceForTests({
    async listTimeEntries() {
      return [];
    },
    async createTimeEntry(input) {
      capturedCorrelationId = input.correlationId;
      return {
        id: 'entry-new',
        workOrderId: input.workOrderId,
        technicianId: input.userId,
        technicianTaskId: null,
        startedAt: new Date(input.startTime),
        endedAt: null,
        manualHours: null,
        description: input.notes ?? null,
        source: 'MANUAL',
        createdAt: new Date('2026-03-20T12:00:00.000Z'),
        updatedAt: new Date('2026-03-20T12:00:00.000Z'),
        computedHours: 0,
      };
    },
    async updateTimeEntry() {
      throw new Error('should not be called');
    },
    async deleteTimeEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await createTimeEntryHandler({
      body: JSON.stringify({
        workOrderId: 'wo-1',
        userId: 'user-1',
        startTime: '2026-03-20T12:00:00.000Z',
        notes: 'Started repair',
      }),
      headers: { 'x-correlation-id': 'corr-te-create' },
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      entry: {
        id: string;
        workOrderId: string;
        userId: string;
        startTime: string;
        notes: string;
        computedHours: number;
      };
    };
    assert.equal(payload.entry.id, 'entry-new');
    assert.equal(payload.entry.workOrderId, 'wo-1');
    assert.equal(payload.entry.userId, 'user-1');
    assert.equal(payload.entry.notes, 'Started repair');
    assert.equal(capturedCorrelationId, 'corr-te-create');
  } finally {
    setTimeEntryServiceForTests(undefined);
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

test('updateTimeEntryHandler returns 400 when ID is missing', async () => {
  const response = await updateTimeEntryHandler({
    body: JSON.stringify({ notes: 'Updated' }),
    pathParameters: {},
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (JSON.parse(response.body) as { message: string }).message,
    'Time entry ID is required.',
  );
});

test('updateTimeEntryHandler returns 200 with updated entry', async () => {
  setTimeEntryServiceForTests({
    async listTimeEntries() {
      return [];
    },
    async createTimeEntry() {
      throw new Error('should not be called');
    },
    async updateTimeEntry(_id, _data) {
      return {
        id: 'entry-1',
        workOrderId: 'wo-1',
        technicianId: 'user-1',
        technicianTaskId: null,
        startedAt: new Date('2026-03-20T08:00:00.000Z'),
        endedAt: new Date('2026-03-20T14:00:00.000Z'),
        manualHours: null,
        description: 'Original note',
        source: 'MANUAL',
        createdAt: new Date('2026-03-20T08:00:00.000Z'),
        updatedAt: new Date('2026-03-20T14:00:00.000Z'),
        computedHours: 6,
      };
    },
    async deleteTimeEntry() {
      throw new Error('should not be called');
    },
  });

  try {
    const response = await updateTimeEntryHandler({
      body: JSON.stringify({ endTime: '2026-03-20T14:00:00.000Z' }),
      pathParameters: { id: 'entry-1' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      entry: { id: string; endTime: string; computedHours: number };
    };
    assert.equal(payload.entry.id, 'entry-1');
    assert.equal(payload.entry.endTime, '2026-03-20T14:00:00.000Z');
    assert.equal(payload.entry.computedHours, 6);
  } finally {
    setTimeEntryServiceForTests(undefined);
  }
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

  setTimeEntryServiceForTests({
    async listTimeEntries() {
      return [];
    },
    async createTimeEntry() {
      throw new Error('should not be called');
    },
    async updateTimeEntry() {
      throw new Error('should not be called');
    },
    async deleteTimeEntry(id) {
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
    setTimeEntryServiceForTests(undefined);
  }
});
