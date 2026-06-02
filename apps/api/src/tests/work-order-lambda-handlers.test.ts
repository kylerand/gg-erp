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
  createRoutingTemplateHandler,
  getBuildPackageReviewPackHandler,
  listBuildConfigurationsHandler,
  listPlanningChangeEventsHandler,
  listRoutingTemplatesHandler,
  resetPlanningMasterStoreForTests,
  setPlanningMasterStoreForTests,
  signOffBuildPackageHandler,
  transitionBuildConfigurationHandler,
  transitionRoutingTemplateHandler,
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
    changeEvents: [
      {
        id: '00000000-0000-4000-8000-000000000811',
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        configurationCode: 'CFG-GG4-STREET',
        configurationVersion: 1,
        changeKind: 'CREATED' as const,
        newStatus: 'DRAFT' as const,
        changeSummary: 'Build configuration draft created for engineering review.',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
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
    changeEvents: [
      {
        id: '00000000-0000-4000-8000-000000000821',
        bomId: '00000000-0000-4000-8000-000000000301',
        bomCode: 'BOM-GG4-STREET-R01',
        buildConfigurationId: config.id,
        revision: 1,
        changeKind: 'CREATED' as const,
        newStatus: 'DRAFT' as const,
        changeSummary: 'BOM revision created for engineering review.',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
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
  const routingTemplate = {
    id: '00000000-0000-4000-8000-000000000601',
    routeCode: 'RT-GG4-STREET',
    routeName: 'GG4 Street Build',
    routeVersion: 1,
    buildConfigurationId: config.id,
    configurationCode: config.configurationCode,
    templateStatus: 'DRAFT' as const,
    effectiveFrom: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    version: 0,
    stepCount: 1,
    estimatedMinutes: 90,
    estimatedLaborCostCents: 14250,
    changeEvents: [
      {
        id: '00000000-0000-4000-8000-000000000801',
        routingTemplateId: '00000000-0000-4000-8000-000000000601',
        routeCode: 'RT-GG4-STREET',
        routeVersion: 1,
        changeKind: 'CREATED' as const,
        newStatus: 'DRAFT' as const,
        changeSummary: 'Route version created for engineering review.',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000701',
        routingTemplateId: '00000000-0000-4000-8000-000000000601',
        sequenceNo: 10,
        operationCode: 'FRAME',
        operationName: 'Frame assembly',
        workstationCode: 'BAY-1',
        estimatedMinutes: 90,
        laborRateCents: 9500,
        laborCostCents: 14250,
        requiredSkillCode: 'MECHANICAL',
        jobCardTitle: 'Frame assembly',
        jobCardInstructions: 'Install lift and torque suspension hardware.',
        qcRequired: true,
        evidenceRequired: false,
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
      return {
        ...config,
        configurationStatus: input.state,
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000812',
            buildConfigurationId: config.id,
            configurationCode: config.configurationCode,
            configurationVersion: config.configurationVersion,
            changeKind: input.state === 'LOCKED' ? ('LOCKED' as const) : ('RELEASED' as const),
            previousStatus: 'DRAFT' as const,
            newStatus: input.state,
            changeSummary: input.changeSummary ?? 'Build configuration moved from DRAFT to LOCKED.',
            approvalNote: input.approvalNote,
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
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
    async approveBom(_id, input) {
      return {
        ...bom,
        bomStatus: 'APPROVED',
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000822',
            bomId: bom.id,
            bomCode: bom.bomCode,
            buildConfigurationId: bom.buildConfigurationId,
            revision: bom.revision,
            changeKind: 'APPROVED' as const,
            previousStatus: 'DRAFT' as const,
            newStatus: 'APPROVED' as const,
            changeSummary: input.changeSummary ?? 'BOM revision 1 approved for production.',
            approvalNote: input.approvalNote,
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    },
    async listRoutingTemplates(input) {
      return { items: [routingTemplate], total: 1, limit: input.limit, offset: input.offset };
    },
    async listPlanningChangeEvents(input) {
      return {
        items: [
          {
            id: config.changeEvents[0].id,
            entityType: 'CONFIGURATION' as const,
            entityId: config.id,
            recordCode: config.configurationCode,
            versionNumber: config.configurationVersion,
            versionLabel: `v${config.configurationVersion}`,
            changeKind: config.changeEvents[0].changeKind,
            newStatus: config.changeEvents[0].newStatus,
            changeSummary: config.changeEvents[0].changeSummary,
            createdAt: config.changeEvents[0].createdAt,
          },
          {
            id: bom.changeEvents[0].id,
            entityType: 'BOM' as const,
            entityId: bom.id,
            recordCode: bom.bomCode,
            versionNumber: bom.revision,
            versionLabel: `rev ${bom.revision}`,
            changeKind: bom.changeEvents[0].changeKind,
            newStatus: bom.changeEvents[0].newStatus,
            changeSummary: bom.changeEvents[0].changeSummary,
            createdAt: bom.changeEvents[0].createdAt,
          },
          {
            id: routingTemplate.changeEvents[0].id,
            entityType: 'ROUTE' as const,
            entityId: routingTemplate.id,
            recordCode: routingTemplate.routeCode,
            versionNumber: routingTemplate.routeVersion,
            versionLabel: `v${routingTemplate.routeVersion}`,
            changeKind: routingTemplate.changeEvents[0].changeKind,
            newStatus: routingTemplate.changeEvents[0].newStatus,
            changeSummary: routingTemplate.changeEvents[0].changeSummary,
            createdAt: routingTemplate.changeEvents[0].createdAt,
          },
        ].filter((event) => !input.entityType || event.entityType === input.entityType),
        total: input.entityType ? 1 : 3,
        limit: input.limit,
        offset: input.offset,
      };
    },
    async getBuildPackageReviewPack(input) {
      const releasedConfig = {
        ...config,
        id: input.buildConfigurationId,
        configurationStatus: 'RELEASED' as const,
        releasedAt: '2026-06-01T00:00:00.000Z',
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000813',
            buildConfigurationId: input.buildConfigurationId,
            configurationCode: config.configurationCode,
            configurationVersion: config.configurationVersion,
            changeKind: 'RELEASED' as const,
            previousStatus: 'LOCKED' as const,
            newStatus: 'RELEASED' as const,
            changeSummary: 'Build configuration released for production.',
            approvalNote: 'ECO-101 released',
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
      const approvedBom = {
        ...bom,
        id: input.bomId,
        buildConfigurationId: input.buildConfigurationId,
        bomStatus: 'APPROVED' as const,
        approvedAt: '2026-06-01T00:00:00.000Z',
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000823',
            bomId: input.bomId,
            bomCode: bom.bomCode,
            buildConfigurationId: input.buildConfigurationId,
            revision: bom.revision,
            changeKind: 'APPROVED' as const,
            previousStatus: 'DRAFT' as const,
            newStatus: 'APPROVED' as const,
            changeSummary: 'BOM revision approved for production.',
            approvalNote: 'Parts reviewed for ECO-101',
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
      const activeRoute = {
        ...routingTemplate,
        templateStatus: 'ACTIVE' as const,
        activatedAt: '2026-06-01T00:00:00.000Z',
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000803',
            routingTemplateId: routingTemplate.id,
            routeCode: routingTemplate.routeCode,
            routeVersion: routingTemplate.routeVersion,
            changeKind: 'ACTIVATED' as const,
            previousStatus: 'DRAFT' as const,
            newStatus: 'ACTIVE' as const,
            changeSummary: 'Route activated for production.',
            approvalNote: 'QC gates reviewed',
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
      const changeEvents = [
        releasedConfig.changeEvents[0],
        approvedBom.changeEvents[0],
        activeRoute.changeEvents[0],
      ].map((event) => ({
        id: event.id,
        entityType:
          'configurationCode' in event ? ('CONFIGURATION' as const) : 'bomId' in event ? ('BOM' as const) : ('ROUTE' as const),
        entityId:
          'buildConfigurationId' in event && !('bomId' in event)
            ? event.buildConfigurationId
            : 'bomId' in event
              ? event.bomId
              : event.routingTemplateId,
        recordCode:
          'configurationCode' in event
            ? event.configurationCode
            : 'bomCode' in event
              ? event.bomCode
              : event.routeCode,
        versionNumber:
          'configurationVersion' in event
            ? event.configurationVersion
            : 'revision' in event
              ? event.revision
              : event.routeVersion,
        versionLabel:
          'configurationVersion' in event
            ? `v${event.configurationVersion}`
            : 'revision' in event
              ? `rev ${event.revision}`
              : `v${event.routeVersion}`,
        changeKind: event.changeKind,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        changeSummary: event.changeSummary,
        approvalNote: event.approvalNote,
        approvedBy: event.approvedBy,
        approvedAt: event.approvedAt,
        appliedBy: event.appliedBy,
        createdAt: event.createdAt,
      }));
      return {
        id: `${input.buildConfigurationId}:${input.bomId}`,
        generatedAt: '2026-06-01T00:00:00.000Z',
        package: {
          id: `${input.buildConfigurationId}:${input.bomId}`,
          buildConfigurationId: input.buildConfigurationId,
          bomId: input.bomId,
          label: `${releasedConfig.configurationCode} / ${approvedBom.bomCode}`,
          description: 'Version 1 · Revision 1 · Acme Golf',
          source: 'PLANNING_MASTER' as const,
          workOrderCount: 2,
          lastUsedAt: '2026-06-01T00:00:00.000Z',
            lastVehicleDisplayName: releasedConfig.vehicleDisplayName,
            lastCustomerDisplayName: releasedConfig.customerDisplayName,
            stateCounts: {
              CONFIG_RELEASED: 1,
              BOM_APPROVED: 1,
              ACTIVE_ROUTES: 1,
              PACKAGE_NEEDS_SIGNOFF: 1,
            },
          },
          configuration: releasedConfig,
          bom: approvedBom,
          routeTemplates: [activeRoute],
          changeEvents,
          approvalEvidence: changeEvents,
          latestSignoff: undefined,
          summary: {
            bomLineCount: approvedBom.lines.length,
            routeCount: 1,
            routeStepCount: activeRoute.stepCount,
            estimatedMinutes: activeRoute.estimatedMinutes,
            estimatedLaborCostCents: activeRoute.estimatedLaborCostCents,
            changeCount: changeEvents.length,
            approvalCount: changeEvents.length,
            signoffCount: 0,
          },
        };
      },
      async signOffBuildPackage(input, context) {
        return {
          id: '00000000-0000-4000-8000-000000000901',
          buildConfigurationId: input.buildConfigurationId,
          bomId: input.bomId,
          packageId: `${input.buildConfigurationId}:${input.bomId}`,
          signoffNote: input.signoffNote,
          signedOffBy: context.actorId ?? 'planner',
          signedOffAt: '2026-06-01T00:00:00.000Z',
          reviewPackGeneratedAt: '2026-06-01T00:00:00.000Z',
          approvalCount: 3,
          changeCount: 3,
          routeCount: 1,
          routeStepCount: 1,
          routeTemplateIds: [routingTemplate.id],
          createdAt: '2026-06-01T00:00:00.000Z',
        };
      },
      async createRoutingTemplate(input) {
      return {
        ...routingTemplate,
        routeCode: input.routeCode,
        routeName: input.routeName,
        buildConfigurationId: input.buildConfigurationId,
        steps: input.steps.map((step, index) => ({
          id: `00000000-0000-4000-8000-0000000007${String(index + 1).padStart(2, '0')}`,
          routingTemplateId: routingTemplate.id,
          sequenceNo: step.sequenceNo ?? index + 1,
          operationCode: step.operationCode,
          operationName: step.operationName,
          workstationCode: step.workstationCode,
          estimatedMinutes: step.estimatedMinutes,
          laborRateCents: step.laborRateCents,
          laborCostCents:
            step.laborRateCents === undefined
              ? 0
              : Math.round((step.estimatedMinutes / 60) * step.laborRateCents),
          requiredSkillCode: step.requiredSkillCode,
          jobCardTitle: step.jobCardTitle,
          jobCardInstructions: step.jobCardInstructions,
          qcRequired: step.qcRequired ?? false,
          evidenceRequired: step.evidenceRequired ?? false,
        })),
      };
    },
    async transitionRoutingTemplate(_id, input) {
      return {
        ...routingTemplate,
        templateStatus: input.status,
        changeEvents: [
          {
            id: '00000000-0000-4000-8000-000000000802',
            routingTemplateId: routingTemplate.id,
            routeCode: routingTemplate.routeCode,
            routeVersion: routingTemplate.routeVersion,
            changeKind: 'ACTIVATED' as const,
            previousStatus: 'DRAFT' as const,
            newStatus: input.status,
            changeSummary: input.changeSummary ?? 'Route version moved from DRAFT to ACTIVE.',
            approvalNote: input.approvalNote,
            approvedBy: 'planner',
            approvedAt: '2026-06-01T00:00:00.000Z',
            appliedBy: 'planner',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
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
            stateCounts: { CONFIG_RELEASED: 1, BOM_APPROVED: 1, PACKAGE_NEEDS_SIGNOFF: 1 },
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

    const missingApprovalResponse = await transitionBuildConfigurationHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000101' },
      body: JSON.stringify({ state: 'LOCKED' }),
    });
    assert.equal(missingApprovalResponse.statusCode, 422);

    const lockResponse = await transitionBuildConfigurationHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000101' },
      body: JSON.stringify({
        state: 'LOCKED',
        approvalNote: 'Approved ECO-17',
      }),
    });
    assert.equal(lockResponse.statusCode, 200);
    const lockPayload = JSON.parse(lockResponse.body) as {
      buildConfiguration: {
        configurationStatus: string;
        changeEvents: Array<{ approvalNote?: string }>;
      };
    };
    assert.equal(lockPayload.buildConfiguration.configurationStatus, 'LOCKED');
    assert.equal(lockPayload.buildConfiguration.changeEvents[0]?.approvalNote, 'Approved ECO-17');
  } finally {
    resetPlanningMasterStoreForTests();
  }
});

test('planning change event handler returns full engineering change history', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const response = await listPlanningChangeEventsHandler({
      queryStringParameters: { entityType: 'ROUTE', limit: '10' },
    });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{ entityType: string; recordCode: string; versionLabel: string }>;
      total: number;
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.entityType, 'ROUTE');
    assert.equal(payload.items[0]?.recordCode, 'RT-GG4-STREET');
    assert.equal(payload.items[0]?.versionLabel, 'v1');

    const invalidResponse = await listPlanningChangeEventsHandler({
      queryStringParameters: { entityType: 'PART' },
    });
    assert.equal(invalidResponse.statusCode, 422);
  } finally {
    resetPlanningMasterStoreForTests();
  }
});

test('build package review pack handler returns approval evidence and package details', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const response = await getBuildPackageReviewPackHandler({
      queryStringParameters: {
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        bomId: '00000000-0000-4000-8000-000000000301',
      },
    });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      reviewPack: {
        package: { source: string; label: string };
        summary: { bomLineCount: number; routeStepCount: number; approvalCount: number };
        approvalEvidence: Array<{ approvalNote?: string }>;
      };
    };
    assert.equal(payload.reviewPack.package.source, 'PLANNING_MASTER');
    assert.equal(payload.reviewPack.package.label, 'CFG-GG4-STREET / BOM-GG4-STREET-R01');
    assert.equal(payload.reviewPack.summary.bomLineCount, 1);
    assert.equal(payload.reviewPack.summary.routeStepCount, 1);
    assert.equal(payload.reviewPack.summary.approvalCount, 3);
    assert.ok(
      payload.reviewPack.approvalEvidence.some((event) =>
        event.approvalNote?.includes('ECO-101'),
      ),
    );

    const invalidResponse = await getBuildPackageReviewPackHandler({
      queryStringParameters: { buildConfigurationId: 'not-a-uuid' },
    });
    assert.equal(invalidResponse.statusCode, 422);
  } finally {
    resetPlanningMasterStoreForTests();
  }
});

test('build package sign-off handler persists package-level approval evidence', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const invalidResponse = await signOffBuildPackageHandler({
      body: JSON.stringify({
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        bomId: '00000000-0000-4000-8000-000000000301',
      }),
    });
    assert.equal(invalidResponse.statusCode, 422);

    const response = await signOffBuildPackageHandler({
      headers: { 'x-actor-id': 'planner@example.com' },
      body: JSON.stringify({
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        bomId: '00000000-0000-4000-8000-000000000301',
        signoffNote: 'Reviewed config, BOM, route, and approval evidence for release.',
      }),
    });
    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      signoff: {
        packageId: string;
        signoffNote: string;
        signedOffBy?: string;
        routeCount: number;
        routeTemplateIds: string[];
      };
    };
    assert.equal(
      payload.signoff.packageId,
      '00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000301',
    );
    assert.equal(payload.signoff.signedOffBy, 'planner@example.com');
    assert.equal(payload.signoff.routeCount, 1);
    assert.deepEqual(payload.signoff.routeTemplateIds, ['00000000-0000-4000-8000-000000000601']);
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

    const missingApprovalResponse = await approveBomHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000301' },
      body: JSON.stringify({}),
    });
    assert.equal(missingApprovalResponse.statusCode, 422);

    const approveResponse = await approveBomHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000301' },
      body: JSON.stringify({ approvalNote: 'Approved ECO-18' }),
    });
    assert.equal(approveResponse.statusCode, 200);
    const approvePayload = JSON.parse(approveResponse.body) as {
      bom: { bomStatus: string; changeEvents: Array<{ approvalNote?: string }> };
    };
    assert.equal(approvePayload.bom.bomStatus, 'APPROVED');
    assert.equal(approvePayload.bom.changeEvents[0]?.approvalNote, 'Approved ECO-18');
  } finally {
    resetPlanningMasterStoreForTests();
  }
});

test('planning routing template handlers validate, create, and activate job-card steps', async () => {
  setPlanningMasterStoreForTests(createPlanningMasterStoreForTests());
  try {
    const listResponse = await listRoutingTemplatesHandler({
      queryStringParameters: { status: 'DRAFT', limit: '10' },
    });
    assert.equal(listResponse.statusCode, 200);
    const listPayload = JSON.parse(listResponse.body) as { items: Array<{ routeCode: string }> };
    assert.equal(listPayload.items[0]?.routeCode, 'RT-GG4-STREET');

    const invalidResponse = await createRoutingTemplateHandler({ body: JSON.stringify({}) });
    assert.equal(invalidResponse.statusCode, 422);

    const createResponse = await createRoutingTemplateHandler({
      body: JSON.stringify({
        routeCode: 'RT-GG4-NEW',
        routeName: 'New GG4 Build',
        buildConfigurationId: '00000000-0000-4000-8000-000000000101',
        steps: [
          {
            operationCode: 'FRAME',
            operationName: 'Frame assembly',
            estimatedMinutes: 75,
            laborRateCents: 9000,
            jobCardTitle: 'Frame install',
            qcRequired: true,
          },
        ],
      }),
    });
    assert.equal(createResponse.statusCode, 201);
    const createPayload = JSON.parse(createResponse.body) as {
      routingTemplate: {
        routeCode: string;
        steps: Array<{ jobCardTitle?: string; qcRequired: boolean; laborCostCents: number }>;
      };
    };
    assert.equal(createPayload.routingTemplate.routeCode, 'RT-GG4-NEW');
    assert.equal(createPayload.routingTemplate.steps[0]?.jobCardTitle, 'Frame install');
    assert.equal(createPayload.routingTemplate.steps[0]?.qcRequired, true);
    assert.equal(createPayload.routingTemplate.steps[0]?.laborCostCents, 11250);

    const activateResponse = await transitionRoutingTemplateHandler({
      pathParameters: { id: '00000000-0000-4000-8000-000000000601' },
      body: JSON.stringify({ status: 'ACTIVE', approvalNote: 'Approved ECO-42' }),
    });
    assert.equal(activateResponse.statusCode, 200);
    const activatePayload = JSON.parse(activateResponse.body) as {
      routingTemplate: {
        templateStatus: string;
        changeEvents: Array<{ approvalNote?: string }>;
      };
    };
    assert.equal(activatePayload.routingTemplate.templateStatus, 'ACTIVE');
    assert.equal(activatePayload.routingTemplate.changeEvents[0]?.approvalNote, 'Approved ECO-42');
  } finally {
    resetPlanningMasterStoreForTests();
  }
});
