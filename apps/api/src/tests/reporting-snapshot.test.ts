import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { getMissingReportingSnapshotKeys, type ErpReportingSnapshot } from '@gg-erp/domain';
import {
  getReportingSnapshotHandler,
  reportingSnapshotQueries,
  type ReportingBlockedWorkOrderRow,
  type ReportingOpenArSummary,
  type ReportingSalesForecastSummary,
} from '../lambda/reporting/handlers.js';

function mockReportingQueries(overrides: {
  workOrderCounts?: Partial<Record<'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED', number>>;
  blockedWorkOrders?: ReportingBlockedWorkOrderRow[];
  shortageParts?: number | Error;
  openReservations?: number | Error;
  salesForecast?: ReportingSalesForecastSummary;
  openAr?: ReportingOpenArSummary | Error;
  failedInvoiceSyncs?: number;
  overdueTraining?: number;
  deniedAuditEvents?: number;
} = {}) {
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
