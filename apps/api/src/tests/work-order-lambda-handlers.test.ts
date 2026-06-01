import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderState } from '../../../../packages/domain/src/model/buildPlanning.js';
import {
  createWorkOrderHandler,
  listBuildPackagesHandler,
  listWorkOrdersHandler,
  summarizeBuildPackages,
} from '../lambda/work-orders/handlers.js';
import {
  approveBomHandler,
  createBomHandler,
  createBuildConfigurationHandler,
  listBuildConfigurationsHandler,
  resetPlanningMasterStoreForTests,
  setPlanningMasterStoreForTests,
  type PlanningMasterStore,
} from '../lambda/work-orders/planning-masters.js';

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

test('listBuildPackagesHandler returns 422 for invalid pagination query', async () => {
  const response = await listBuildPackagesHandler({
    queryStringParameters: {
      offset: '-1',
    },
  });

  assert.equal(response.statusCode, 422);
  const payload = JSON.parse(response.body) as {
    message: string;
    issues: Array<{ field: string }>;
  };
  assert.equal(payload.message, 'Build package query validation failed.');
  assert.ok(payload.issues.some((issue) => issue.field === 'offset'));
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

function createPlanningMasterStoreForTests(): PlanningMasterStore {
  const config = {
    id: '00000000-0000-4000-8000-000000000101',
    configurationCode: 'CFG-GG4-STREET',
    vehicleId: '00000000-0000-4000-8000-000000000201',
    vehicleDisplayName: '2026 GG4 · SN-1001',
    customerDisplayName: 'Acme Golf',
    configurationVersion: 1,
    configurationStatus: 'DRAFT' as const,
    selectedOptions: ['Lithium Pack'],
    notes: 'Street package',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    version: 0,
  };
  const bom = {
    id: '00000000-0000-4000-8000-000000000301',
    bomCode: 'BOM-GG4-STREET-R01',
    buildConfigurationId: config.id,
    configurationCode: config.configurationCode,
    revision: 1,
    bomStatus: 'DRAFT' as const,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    version: 0,
    lines: [
      {
        id: '00000000-0000-4000-8000-000000000401',
        bomId: '00000000-0000-4000-8000-000000000301',
        partId: '00000000-0000-4000-8000-000000000501',
        sku: 'GG-LIFT',
        partName: 'Lift Kit',
        unitOfMeasure: 'EA',
        quantityPerUnit: 1,
        scrapFactor: 0,
      },
    ],
  };

  return {
    async listBuildConfigurations(input) {
      return { items: [config], total: 1, limit: input.limit, offset: input.offset };
    },
    async createBuildConfiguration(input) {
      return {
        ...config,
        configurationCode: input.configurationCode,
        vehicleId: input.vehicleId,
        selectedOptions: input.selectedOptions ?? [],
        notes: input.notes,
      };
    },
    async transitionBuildConfiguration(_id, input) {
      return { ...config, configurationStatus: input.state };
    },
    async listBoms(input) {
      return { items: [bom], total: 1, limit: input.limit, offset: input.offset };
    },
    async createBom(input) {
      return {
        ...bom,
        bomCode: input.bomCode,
        buildConfigurationId: input.buildConfigurationId,
        revision: input.revision ?? 1,
      };
    },
    async approveBom() {
      return { ...bom, bomStatus: 'APPROVED' };
    },
    async listBuildPackages(input) {
      return {
        items: [
          {
            id: `${config.id}:${bom.id}`,
            buildConfigurationId: config.id,
            bomId: bom.id,
            label: `${config.configurationCode} / ${bom.bomCode}`,
            description: 'Acme Golf',
            source: 'PLANNING_MASTER',
            workOrderCount: 0,
            lastUsedAt: '2026-06-01T00:00:00.000Z',
            lastVehicleDisplayName: config.vehicleDisplayName,
            lastCustomerDisplayName: config.customerDisplayName,
            stateCounts: { CONFIG_RELEASED: 1, BOM_APPROVED: 1 },
          },
        ],
        total: 1,
        limit: input.limit ?? 100,
        offset: input.offset ?? 0,
        source: 'PLANNING_MASTER',
      };
    },
  };
}

test('planning master handlers list and create build configurations', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const listResponse = await listBuildConfigurationsHandler({
      queryStringParameters: { limit: '10' },
    });
    assert.equal(listResponse.statusCode, 200);
    const listPayload = JSON.parse(listResponse.body) as { items: Array<{ configurationCode: string }> };
    assert.equal(listPayload.items[0]?.configurationCode, 'CFG-GG4-STREET');

    const createResponse = await createBuildConfigurationHandler({
      body: JSON.stringify({
        configurationCode: 'CFG-GG4-NEW',
        vehicleId: '00000000-0000-4000-8000-000000000201',
        selectedOptions: ['Audio'],
      }),
    });
    assert.equal(createResponse.statusCode, 201);
    const createPayload = JSON.parse(createResponse.body) as {
      buildConfiguration: { configurationCode: string; selectedOptions: string[] };
    };
    assert.equal(createPayload.buildConfiguration.configurationCode, 'CFG-GG4-NEW');
    assert.deepEqual(createPayload.buildConfiguration.selectedOptions, ['Audio']);
  } finally {
    resetPlanningMasterStoreForTests();
  }
});

test('planning BOM handlers validate and approve revisions', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const invalidResponse = await createBomHandler({ body: JSON.stringify({}) });
    assert.equal(invalidResponse.statusCode, 422);

    const createResponse = await createBomHandler({
      body: JSON.stringify({
        bomCode: 'BOM-GG4-NEW-R01',
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        lines: [
          {
            partId: '00000000-0000-4000-8000-000000000501',
            quantityPerUnit: 1,
            scrapFactor: 0,
          },
        ],
      }),
    });
    assert.equal(createResponse.statusCode, 201);

    const approveResponse = await approveBomHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000301' },
    });
    assert.equal(approveResponse.statusCode, 200);
    const approvePayload = JSON.parse(approveResponse.body) as { bom: { bomStatus: string } };
    assert.equal(approvePayload.bom.bomStatus, 'APPROVED');
  } finally {
    resetPlanningMasterStoreForTests();
  }
});
