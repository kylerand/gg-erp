import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderState } from '../../../../packages/domain/src/model/buildPlanning.js';
import {
  createWorkOrderHandler,
  listWorkOrdersHandler,
  summarizeBuildPackages,
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

test('summarizeBuildPackages creates live package catalog entries from enriched work orders', () => {
  const packages = summarizeBuildPackages([
    {
      id: 'wo-1',
      workOrderNumber: 'WO-1001',
      vehicleId: 'cart-1',
      vehicleProfile: {
        id: 'cart-1',
        displayName: '2026 GG4 · SN-1',
        vin: 'VIN-1',
        serialNumber: 'SN-1',
        modelCode: 'GG4',
        modelYear: 2026,
        state: 'REGISTERED',
        customerId: 'customer-1',
      },
      customerProfile: {
        id: 'customer-1',
        displayName: 'Acme Golf',
        fullName: 'Alex Customer',
        companyName: 'Acme Golf',
        email: 'alex@example.com',
        state: 'ACTIVE',
      },
      buildConfigurationId: 'cfg-street-legal',
      bomId: 'bom-street-legal-r1',
      state: WorkOrderState.PLANNED,
      createdAt: '2026-05-30T12:00:00.000Z',
      updatedAt: '2026-05-30T12:00:00.000Z',
    },
    {
      id: 'wo-2',
      workOrderNumber: 'WO-1002',
      vehicleId: 'cart-2',
      buildConfigurationId: 'cfg-street-legal',
      bomId: 'bom-street-legal-r1',
      state: WorkOrderState.RELEASED,
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
    },
  ]);

  assert.equal(packages.length, 1);
  assert.equal(packages[0]?.buildConfigurationId, 'cfg-street-legal');
  assert.equal(packages[0]?.bomId, 'bom-street-legal-r1');
  assert.equal(packages[0]?.workOrderCount, 2);
  assert.equal(packages[0]?.lastWorkOrderNumber, 'WO-1002');
  assert.equal(packages[0]?.stateCounts.PLANNED, 1);
  assert.equal(packages[0]?.stateCounts.RELEASED, 1);
});
