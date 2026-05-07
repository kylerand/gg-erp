import assert from 'node:assert/strict';
import test from 'node:test';
import { listVehiclesHandler } from '../lambda/vehicles/handlers.js';

test('listVehiclesHandler returns 422 for invalid vehicle state', async () => {
  const response = await listVehiclesHandler({
    queryStringParameters: {
      state: 'NOT_A_STATE',
    },
  });

  assert.equal(response.statusCode, 422);
  const payload = JSON.parse(response.body) as { message: string };
  assert.equal(payload.message, 'Invalid vehicle state: NOT_A_STATE.');
});
