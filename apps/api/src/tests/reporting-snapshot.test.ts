import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  getMissingReportingSnapshotKeys,
  type ErpBlockedAlert,
  type ErpBlockedAlertFeed,
  type ErpBlockedAlertTriageResult,
  type ErpReportExportRun,
  type ErpReportSubscription,
  type ErpReportSubscriptionList,
  type ErpReportingSnapshot,
} from '@gg-erp/domain';
import {
  createReportSubscriptionHandler,
  getBlockedAlertsHandler,
  getReportingSnapshotHandler,
  listReportSubscriptionsHandler,
  recordBlockedAlertTriageActionHandler,
  runReportExportNowHandler,
  reportingSnapshotQueries,
  type ReportingBlockedWorkOrderRow,
  type ReportingOpenArSummary,
  type ReportingSalesForecastSummary,
} from '../lambda/reporting/handlers.js';

function mockReportingQueries(
  overrides: {
    workOrderCounts?: Partial<Record<'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED', number>>;
    blockedWorkOrders?: ReportingBlockedWorkOrderRow[];
    shortageParts?: number | Error;
    openReservations?: number | Error;
    salesForecast?: ReportingSalesForecastSummary;
    openAr?: ReportingOpenArSummary | Error;
    failedInvoiceSyncs?: number;
    overdueTraining?: number;
    deniedAuditEvents?: number;
    blockedAlerts?: ErpBlockedAlert[];
  } = {},
) {
  return [
    mock.method(
      reportingSnapshotQueries,
      'countWorkOrders',
      async (status: 'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED') =>
        overrides.workOrderCounts?.[status] ?? 0,
    ),
    mock.method(
      reportingSnapshotQueries,
      'listBlockedWorkOrders',
      async () => overrides.blockedWorkOrders ?? [],
    ),
    mock.method(reportingSnapshotQueries, 'countShortageParts', async () => {
      if (overrides.shortageParts instanceof Error) throw overrides.shortageParts;
      return overrides.shortageParts ?? 0;
    }),
    mock.method(reportingSnapshotQueries, 'countOpenReservations', async () => {
      if (overrides.openReservations instanceof Error) throw overrides.openReservations;
      return overrides.openReservations ?? 0;
    }),
    mock.method(
      reportingSnapshotQueries,
      'getSalesForecast',
      async () => overrides.salesForecast ?? { dealCount: 0, weightedForecast: 0 },
    ),
    mock.method(reportingSnapshotQueries, 'getOpenAccountsReceivable', async () => {
      if (overrides.openAr instanceof Error) throw overrides.openAr;
      return overrides.openAr ?? { openInvoiceCount: 0, openInvoiceBalance: 0 };
    }),
    mock.method(
      reportingSnapshotQueries,
      'countFailedInvoiceSyncs',
      async () => overrides.failedInvoiceSyncs ?? 0,
    ),
    mock.method(
      reportingSnapshotQueries,
      'countOverdueTrainingAssignments',
      async () => overrides.overdueTraining ?? 0,
    ),
    mock.method(
      reportingSnapshotQueries,
      'countDeniedAuditEvents',
      async () => overrides.deniedAuditEvents ?? 0,
    ),
    mock.method(
      reportingSnapshotQueries,
      'listBlockedAlerts',
      async () => overrides.blockedAlerts ?? [],
    ),
  ];
}

test('GET /reporting/snapshot returns live metrics for every report card', async () => {
  const mocks = mockReportingQueries({
    workOrderCounts: { BLOCKED: 2, IN_PROGRESS: 7, COMPLETED: 11 },
    blockedWorkOrders: [
      { id: 'wo-1', workOrderNumber: 'WO-100', title: 'Battery tray blocked' },
      { id: 'wo-2', workOrderNumber: 'WO-101', title: 'Controller install blocked' },
    ],
    shortageParts: 3,
    openReservations: 4,
    salesForecast: { dealCount: 5, weightedForecast: 125000 },
    openAr: { openInvoiceCount: 2, openInvoiceBalance: 4200 },
    failedInvoiceSyncs: 1,
    overdueTraining: 6,
    deniedAuditEvents: 0,
  });

  try {
    const response = await getReportingSnapshotHandler({
      httpMethod: 'GET',
      path: '/reporting/snapshot',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as ErpReportingSnapshot;

    assert.equal(body.metrics['report-work-order-blockers']?.value, '2');
    assert.equal(body.metrics['report-active-shop-load']?.value, '7');
    assert.equal(body.metrics['report-sales-forecast']?.value, '$125,000');
    assert.equal(body.metrics['report-open-accounts-receivable']?.value, '2 / $4,200');
    assert.equal(body.blockedWorkOrders.length, 2);
    assert.equal(body.warnings.length, 0);
    assert.deepEqual(getMissingReportingSnapshotKeys(body), []);
    assert.ok(
      Object.values(body.freshness).every((freshness) => freshness.status === 'LIVE'),
      'all mocked sources should be live',
    );
  } finally {
    for (const item of mocks) item.mock.restore();
  }
});

test('GET /reporting/blocked-alerts returns unified blocker triage feed', async () => {
  const blockedAlerts: ErpBlockedAlert[] = [
    {
      id: 'OPERATION:op-1',
      sourceType: 'OPERATION',
      sourceId: 'op-1',
      workOrderId: 'wo-1',
      workOrderNumber: 'WO-100',
      workOrderTitle: 'Battery tray - Wiring',
      customerReference: 'Pier Motorsports',
      assetReference: 'Cart 42',
      reason: 'Waiting on controller PO.',
      reasonCode: 'WAITING_PARTS',
      ownerRole: 'parts_coordinator',
      ownerLabel: 'Parts Coordinator',
      severity: 'P2',
      ageMinutes: 90,
      updatedAt: '2026-06-01T00:00:00.000Z',
      nextAction: 'Confirm part availability, PO status, or substitution path.',
      route: '/work-orders/wo-1',
      actions: [{ label: 'Open work order', href: '/work-orders/wo-1' }],
      triageState: 'ACKNOWLEDGED',
      lastTriageAction: 'ACKNOWLEDGE',
      lastTriagedAt: '2026-06-01T01:00:00.000Z',
      lastTriageNote: 'Parts team owns this.',
    },
  ];
  const mocks = mockReportingQueries({ blockedAlerts });

  try {
    const response = await getBlockedAlertsHandler({
      httpMethod: 'GET',
      path: '/reporting/blocked-alerts',
      queryStringParameters: { limit: '25' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as ErpBlockedAlertFeed;
    assert.equal(body.summary.total, 1);
    assert.equal(body.summary.p2, 1);
    assert.equal(body.summary.acknowledged, 1);
    assert.equal(body.summary.averageAgeMinutes, 90);
    assert.equal(body.items[0].ownerLabel, 'Parts Coordinator');
    assert.equal(body.items[0].triageState, 'ACKNOWLEDGED');
    assert.equal(body.items[0].route, '/work-orders/wo-1');
  } finally {
    for (const item of mocks) item.mock.restore();
  }
});

test('POST /reporting/blocked-alerts/{alertId}/escalate records triage evidence', async () => {
  const activeAlert: ErpBlockedAlert = {
    id: 'OPERATION:op-1',
    sourceType: 'OPERATION',
    sourceId: 'op-1',
    workOrderId: 'wo-1',
    workOrderNumber: 'WO-100',
    workOrderTitle: 'Battery tray - Wiring',
    customerReference: 'Pier Motorsports',
    assetReference: 'Cart 42',
    reason: 'Waiting on controller PO.',
    reasonCode: 'WAITING_PARTS',
    ownerRole: 'parts_coordinator',
    ownerLabel: 'Parts Coordinator',
    severity: 'P2',
    ageMinutes: 90,
    updatedAt: '2026-06-01T00:00:00.000Z',
    nextAction: 'Confirm part availability, PO status, or substitution path.',
    route: '/work-orders/wo-1',
    actions: [{ label: 'Open work order', href: '/work-orders/wo-1' }],
    triageState: 'OPEN',
  };

  const listMock = mock.method(reportingSnapshotQueries, 'listBlockedAlerts', async () => [
    activeAlert,
  ]);
  const recordMock = mock.method(
    reportingSnapshotQueries,
    'recordBlockedAlertTriageAction',
    async (input: {
      alert: ErpBlockedAlert;
      action: 'ESCALATE';
      note?: string;
      ownerRole?: string;
      correlationId: string;
    }) => ({
      id: 'triage-1',
      alertId: input.alert.id,
      action: input.action,
      note: input.note,
      ownerRole: input.ownerRole,
      createdAt: '2026-06-01T02:00:00.000Z',
    }),
  );

  try {
    const response = await recordBlockedAlertTriageActionHandler({
      httpMethod: 'POST',
      path: '/reporting/blocked-alerts/OPERATION%3Aop-1/escalate',
      body: JSON.stringify({ note: 'Vendor ETA missed.', ownerRole: 'shop_manager' }),
      headers: { 'x-correlation-id': 'triage-test-1' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as ErpBlockedAlertTriageResult;
    assert.equal(body.alertId, 'OPERATION:op-1');
    assert.equal(body.triageState, 'ESCALATED');
    assert.equal(body.event.note, 'Vendor ETA missed.');
    assert.equal(body.event.ownerRole, 'shop_manager');
  } finally {
    listMock.mock.restore();
    recordMock.mock.restore();
  }
});

test('GET /reporting/subscriptions returns persisted saved-view schedules', async () => {
  const listMock = mock.method(reportingSnapshotQueries, 'listReportSubscriptions', async () => [
    {
      id: 'sub-1',
      viewKey: 'saved-report-daily-shop-pulse',
      viewLabel: 'Daily Shop Pulse',
      cadence: 'daily',
      timezone: 'America/New_York',
      format: 'CSV',
      enabled: true,
      nextRunAt: '2026-06-02T12:00:00.000Z',
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    } satisfies ErpReportSubscription,
  ]);

  try {
    const response = await listReportSubscriptionsHandler({
      httpMethod: 'GET',
      path: '/reporting/subscriptions',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as ErpReportSubscriptionList;
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].viewLabel, 'Daily Shop Pulse');
    assert.equal(body.items[0].enabled, true);
  } finally {
    listMock.mock.restore();
  }
});

test('POST /reporting/subscriptions persists an in-app CSV subscription', async () => {
  const createMock = mock.method(
    reportingSnapshotQueries,
    'createReportSubscription',
    async (input: {
      viewKey: string;
      cadence: 'daily';
      timezone: string;
      enabled: boolean;
      createdByUserId?: string;
      correlationId: string;
    }) => ({
      id: 'sub-1',
      viewKey: input.viewKey,
      viewLabel: 'Daily Shop Pulse',
      cadence: input.cadence,
      timezone: input.timezone,
      format: 'CSV',
      enabled: input.enabled,
      createdByUserId: input.createdByUserId,
      nextRunAt: '2026-06-02T12:00:00.000Z',
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }),
  );

  try {
    const response = await createReportSubscriptionHandler({
      httpMethod: 'POST',
      path: '/reporting/subscriptions',
      headers: { 'x-actor-id': '00000000-0000-4000-8000-000000000001' },
      body: JSON.stringify({
        viewKey: 'saved-report-daily-shop-pulse',
        cadence: 'daily',
        timezone: 'America/New_York',
        enabled: true,
      }),
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body) as ErpReportSubscription;
    assert.equal(body.viewKey, 'saved-report-daily-shop-pulse');
    assert.equal(body.cadence, 'daily');
    assert.equal(body.format, 'CSV');
  } finally {
    createMock.mock.restore();
  }
});

test('POST /reporting/exports/run-now generates CSV evidence for a saved view', async () => {
  const mocks = mockReportingQueries({
    workOrderCounts: { BLOCKED: 1, IN_PROGRESS: 4, COMPLETED: 8 },
    shortageParts: 2,
    openReservations: 3,
    salesForecast: { dealCount: 0, weightedForecast: 0 },
    openAr: { openInvoiceCount: 0, openInvoiceBalance: 0 },
    failedInvoiceSyncs: 0,
    overdueTraining: 0,
    deniedAuditEvents: 0,
  });
  const createRunMock = mock.method(
    reportingSnapshotQueries,
    'createReportExportRun',
    async (input: { viewKey: string; filename: string }) =>
      ({
        id: 'run-1',
        viewKey: input.viewKey,
        viewLabel: 'Daily Shop Pulse',
        status: 'RUNNING',
        format: 'CSV',
        scheduledFor: '2026-06-01T12:00:00.000Z',
        startedAt: '2026-06-01T12:00:00.000Z',
        rowCount: 0,
        filename: input.filename,
        createdAt: '2026-06-01T12:00:00.000Z',
      }) satisfies ErpReportExportRun,
  );
  const completeRunMock = mock.method(
    reportingSnapshotQueries,
    'completeReportExportRun',
    async (input: { id: string; status: 'SUCCEEDED'; rowCount?: number; csvText?: string }) =>
      ({
        id: input.id,
        viewKey: 'saved-report-daily-shop-pulse',
        viewLabel: 'Daily Shop Pulse',
        status: input.status,
        format: 'CSV',
        scheduledFor: '2026-06-01T12:00:00.000Z',
        startedAt: '2026-06-01T12:00:00.000Z',
        completedAt: '2026-06-01T12:00:01.000Z',
        rowCount: input.rowCount ?? 0,
        filename: 'daily-shop-pulse-2026-06-01.csv',
        csvText: input.csvText,
        createdAt: '2026-06-01T12:00:00.000Z',
      }) satisfies ErpReportExportRun,
  );

  try {
    const response = await runReportExportNowHandler({
      httpMethod: 'POST',
      path: '/reporting/exports/run-now',
      body: JSON.stringify({ viewKey: 'saved-report-daily-shop-pulse' }),
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body) as ErpReportExportRun;
    assert.equal(body.status, 'SUCCEEDED');
    assert.equal(body.rowCount, 4);
    assert.ok(body.csvText?.includes('report-active-shop-load'));
    assert.ok(body.csvText?.includes('metricValue'));
  } finally {
    createRunMock.mock.restore();
    completeRunMock.mock.restore();
    for (const item of mocks) item.mock.restore();
  }
});

test('GET /reporting/snapshot keeps partial results and marks failed sources', async () => {
  const mocks = mockReportingQueries({
    workOrderCounts: { BLOCKED: 0, IN_PROGRESS: 1, COMPLETED: 3 },
    openReservations: new Error('reservation read failed'),
    openAr: new Error('QuickBooks token expired'),
  });

  try {
    const response = await getReportingSnapshotHandler({
      httpMethod: 'GET',
      path: '/reporting/snapshot',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as ErpReportingSnapshot;

    assert.equal(body.metrics['report-active-shop-load']?.value, '1');
    assert.equal(body.metrics['report-open-reservations'], undefined);
    assert.equal(body.freshness['report-open-reservations']?.status, 'ERROR');
    assert.equal(body.freshness['report-open-accounts-receivable']?.status, 'ERROR');
    assert.ok(body.warnings.some((warning) => warning.source === 'inventory.reservations'));
    assert.ok(body.warnings.some((warning) => warning.source === 'quickbooks.open_ar'));
    assert.deepEqual(getMissingReportingSnapshotKeys(body), []);
  } finally {
    for (const item of mocks) item.mock.restore();
  }
});
