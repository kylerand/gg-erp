import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';
import {
  createTrainingAssignmentsHandler,
  listBookmarksHandler,
  listNotesHandler,
  toggleBookmarkHandler,
  trainingAssignmentQueries,
  trainingStateQueries,
  upsertNoteHandler,
} from '../lambda/sop/handlers.js';

const EMPLOYEE_ID = '00000000-0000-0000-0004-000000000002';
const SECOND_EMPLOYEE_ID = '00000000-0000-0000-0004-000000000003';
const MODULE_ID = '00000000-0000-0000-0011-000000000001';
const MODULE_CODE = 'OJT-BUILD-BASICS';
const NOW = new Date('2026-05-18T12:00:00.000Z');

function moduleReference() {
  return {
    id: MODULE_ID,
    moduleCode: MODULE_CODE,
    moduleName: 'Golf Cart Build Basics',
  };
}

function assignmentRecord(employeeId: string, id = `assignment-${employeeId.slice(-1)}`) {
  return {
    id,
    moduleId: MODULE_ID,
    employeeId,
    assignmentStatus: 'ASSIGNED' as const,
    dueAt: new Date('2026-06-01T23:59:59.000Z'),
    startedAt: null,
    completedAt: null,
    score: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
    module: {
      moduleCode: MODULE_CODE,
      moduleName: 'Golf Cart Build Basics',
      passScore: 80,
      validityDays: null,
      isRequired: true,
      sopDocument: { documentCode: 'SOP-BUILD', title: 'Build SOP' },
    },
  };
}

test('createTrainingAssignmentsHandler creates missing active employee assignments only', async () => {
  const moduleMock = mock.method(trainingAssignmentQueries, 'findAssignableModule', async (idOrCode: string) => {
    assert.equal(idOrCode, MODULE_CODE);
    return {
      id: MODULE_ID,
      moduleCode: MODULE_CODE,
      moduleName: 'Golf Cart Build Basics',
      moduleStatus: 'ACTIVE',
      passScore: 80,
      validityDays: null,
      isRequired: true,
      sopDocument: { documentCode: 'SOP-BUILD', title: 'Build SOP' },
    };
  });
  const employeesMock = mock.method(trainingAssignmentQueries, 'listEmployeesByIds', async (employeeIds: string[]) => {
    assert.deepEqual(employeeIds, [EMPLOYEE_ID, SECOND_EMPLOYEE_ID]);
    return [{ id: EMPLOYEE_ID }, { id: SECOND_EMPLOYEE_ID }];
  });
  const activeMock = mock.method(
    trainingAssignmentQueries,
    'findActiveAssignments',
    async (moduleId: string, employeeIds: string[]) => {
      assert.equal(moduleId, MODULE_ID);
      assert.deepEqual(employeeIds, [EMPLOYEE_ID, SECOND_EMPLOYEE_ID]);
      return [assignmentRecord(SECOND_EMPLOYEE_ID, 'existing-assignment')];
    },
  );
  const createMock = mock.method(
    trainingAssignmentQueries,
    'createAssignments',
    async (input: Parameters<typeof trainingAssignmentQueries.createAssignments>[0]) => {
      assert.equal(input.length, 1);
      assert.equal(input[0].moduleId, MODULE_ID);
      assert.equal(input[0].employeeId, EMPLOYEE_ID);
      assert.equal(input[0].dueAt?.toISOString(), '2026-06-01T23:59:59.000Z');
      assert.match(input[0].correlationId, /^[0-9a-f-]{36}$/);
      return [assignmentRecord(EMPLOYEE_ID, 'created-assignment')];
    },
  );

  try {
    const response = await createTrainingAssignmentsHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        moduleId: MODULE_CODE,
        employeeIds: [EMPLOYEE_ID, SECOND_EMPLOYEE_ID],
        dueAt: '2026-06-01T23:59:59.000Z',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; employeeId: string; module?: { moduleCode: string } }>;
      skipped: Array<{ id: string; employeeId: string }>;
      totalCreated: number;
      totalSkipped: number;
    };
    assert.equal(payload.totalCreated, 1);
    assert.equal(payload.totalSkipped, 1);
    assert.equal(payload.items[0].employeeId, EMPLOYEE_ID);
    assert.equal(payload.items[0].module?.moduleCode, MODULE_CODE);
    assert.equal(payload.skipped[0].employeeId, SECOND_EMPLOYEE_ID);
    assert.equal(moduleMock.mock.calls.length, 1);
    assert.equal(employeesMock.mock.calls.length, 1);
    assert.equal(activeMock.mock.calls.length, 1);
    assert.equal(createMock.mock.calls.length, 1);
  } finally {
    moduleMock.mock.restore();
    employeesMock.mock.restore();
    activeMock.mock.restore();
    createMock.mock.restore();
  }
});

test('listNotesHandler resolves module codes to canonical module ids', async () => {
  const moduleMock = mock.method(trainingStateQueries, 'findModuleReference', async () =>
    moduleReference(),
  );
  const listMock = mock.method(
    trainingStateQueries,
    'listNotes',
    async (employeeId: string, moduleId?: string) => {
      assert.equal(employeeId, EMPLOYEE_ID);
      assert.equal(moduleId, MODULE_ID);
      return [
        {
          id: 'note-1',
          moduleId: MODULE_ID,
          stepId: 'stage-cart',
          content: 'Check lift points.',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];
    },
  );

  try {
    const response = await listNotesHandler({
      httpMethod: 'GET',
      queryStringParameters: { employeeId: EMPLOYEE_ID, moduleId: MODULE_CODE },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(moduleMock.mock.calls.length, 1);
    assert.equal(listMock.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as { items: Array<{ moduleId: string }> };
    assert.equal(payload.items[0].moduleId, MODULE_ID);
  } finally {
    moduleMock.mock.restore();
    listMock.mock.restore();
  }
});

test('upsertNoteHandler validates and writes notes against resolved module ids', async () => {
  const moduleMock = mock.method(trainingStateQueries, 'findModuleReference', async () =>
    moduleReference(),
  );
  const existingMock = mock.method(trainingStateQueries, 'findExistingNote', async () => null);
  const createMock = mock.method(
    trainingStateQueries,
    'createNote',
    async (input: Parameters<typeof trainingStateQueries.createNote>[0]) => {
      assert.equal(input.employeeId, EMPLOYEE_ID);
      assert.equal(input.moduleId, MODULE_ID);
      assert.equal(input.stepId, 'quality-handoff');
      assert.equal(input.content, 'Verify torque marks.');
      return {
        id: 'note-2',
        moduleId: input.moduleId,
        stepId: input.stepId,
        content: input.content,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
    },
  );

  try {
    const response = await upsertNoteHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        employeeId: EMPLOYEE_ID,
        moduleId: MODULE_CODE,
        stepId: 'quality-handoff',
        content: '  Verify torque marks.  ',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(moduleMock.mock.calls.length, 1);
    assert.equal(existingMock.mock.calls.length, 1);
    assert.equal(createMock.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as { content: string; moduleId: string };
    assert.equal(payload.content, 'Verify torque marks.');
    assert.equal(payload.moduleId, MODULE_ID);
  } finally {
    moduleMock.mock.restore();
    existingMock.mock.restore();
    createMock.mock.restore();
  }
});

test('listBookmarksHandler resolves module codes before filtering bookmarks', async () => {
  const moduleMock = mock.method(trainingStateQueries, 'findModuleReference', async () =>
    moduleReference(),
  );
  const listMock = mock.method(
    trainingStateQueries,
    'listBookmarks',
    async (employeeId: string, moduleId?: string) => {
      assert.equal(employeeId, EMPLOYEE_ID);
      assert.equal(moduleId, MODULE_ID);
      return [{ id: 'bookmark-1', moduleId: MODULE_ID, stepId: 'stage-cart', createdAt: NOW }];
    },
  );

  try {
    const response = await listBookmarksHandler({
      httpMethod: 'GET',
      queryStringParameters: { employeeId: EMPLOYEE_ID, moduleId: MODULE_CODE },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(moduleMock.mock.calls.length, 1);
    assert.equal(listMock.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as { items: Array<{ stepId: string }> };
    assert.equal(payload.items[0].stepId, 'stage-cart');
  } finally {
    moduleMock.mock.restore();
    listMock.mock.restore();
  }
});

test('toggleBookmarkHandler deletes existing bookmark by resolved module id', async () => {
  const moduleMock = mock.method(trainingStateQueries, 'findModuleReference', async () =>
    moduleReference(),
  );
  const findMock = mock.method(trainingStateQueries, 'findBookmark', async (
    employeeId: string,
    moduleId: string,
    stepId: string,
  ) => {
    assert.equal(employeeId, EMPLOYEE_ID);
    assert.equal(moduleId, MODULE_ID);
    assert.equal(stepId, 'stage-cart');
    return { id: 'bookmark-1', moduleId: MODULE_ID, stepId: 'stage-cart', createdAt: NOW };
  });
  const deleteMock = mock.method(trainingStateQueries, 'deleteBookmark', async (id: string) => {
    assert.equal(id, 'bookmark-1');
  });

  try {
    const response = await toggleBookmarkHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        employeeId: EMPLOYEE_ID,
        moduleId: MODULE_CODE,
        stepId: ' stage-cart ',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { bookmarked: false });
    assert.equal(moduleMock.mock.calls.length, 1);
    assert.equal(findMock.mock.calls.length, 1);
    assert.equal(deleteMock.mock.calls.length, 1);
  } finally {
    moduleMock.mock.restore();
    findMock.mock.restore();
    deleteMock.mock.restore();
  }
});

test('training state mutations reject invalid employee ids before module lookup', async () => {
  const moduleMock = mock.method(trainingStateQueries, 'findModuleReference', async () =>
    moduleReference(),
  );

  try {
    const response = await toggleBookmarkHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        employeeId: 'not-a-uuid',
        moduleId: MODULE_CODE,
        stepId: 'stage-cart',
      }),
    });

    assert.equal(response.statusCode, 422);
    assert.equal(moduleMock.mock.calls.length, 0);
  } finally {
    moduleMock.mock.restore();
  }
});

test('training assignment creation is wired into lambda build and API gateway routes', () => {
  const tf = readFileSync(
    new URL('../../../../infra/terraform/modules/api-gateway-lambda/main.tf', import.meta.url),
    'utf8',
  );
  const build = readFileSync(new URL('../../../../scripts/build-lambdas.ts', import.meta.url), 'utf8');

  assert.match(build, /create-assignments\.handler\.ts/);
  assert.match(tf, /aws_lambda_function" "sop_create_assignments"/);
  assert.match(tf, /route_key\s+= "GET \/sop\/modules"/);
  assert.match(tf, /route_key\s+= "POST \/ojt\/assignments"/);
});
