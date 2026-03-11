import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkOrderHandler,
  listWorkOrdersHandler,
} from '../lambda/work-orders/handlers.js';

test('createWorkOrderHandler returns 400 for invalid JSON', async () => {
  const response = await createWorkOrderHandler({
    body: '{invalid-json',
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body) as { message: string };
  assert.equal(payload.message, 'Invalid JSON payload.');
});

test('listWorkOrdersHandler returns 422 for invalid pagination query', async () => {
  const response = await listWorkOrdersHandler({
    queryStringParameters: {
      limit: '-5',
    },
  });

  assert.equal(response.statusCode, 422);
  const payload = JSON.parse(response.body) as {
    message: string;
    issues: Array<{ field: string }>;
  };
  assert.equal(payload.message, 'Work order query validation failed.');
  assert.ok(payload.issues.some((issue) => issue.field === 'limit'));
});
