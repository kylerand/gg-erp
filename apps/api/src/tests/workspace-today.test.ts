import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  getWorkspaceTodayHandler,
  workspaceTodayQueries,
  type BlockedWorkOrderRow,
  type InvoiceSyncRow,
  type ShortagePartRow,
  type WorkspaceTodayResponse,
} from '../lambda/workspace/handlers.js';

const now = new Date('2026-04-28T12:00:00.000Z');

function mockTodayQueries(overrides: {
  blockedWorkOrders?: BlockedWorkOrderRow[];
  shortageParts?: ShortagePartRow[] | Error;
  failedInvoiceSyncs?: InvoiceSyncRow[];
} = {}) {
  return [
    mock.method(workspaceTodayQueries, 'listBlockedWorkOrders', async () => overrides.blockedWorkOrders ?? []),
    mock.method(workspaceTodayQueries, 'listUnassignedReadyTasks', async () => []),
    mock.method(workspaceTodayQueries, 'listShortageParts', async () => {
      if (overrides.shortageParts instanceof Error) throw overrides.shortageParts;
      return overrides.shortageParts ?? [];
    }),
    mock.method(workspaceTodayQueries, 'listOpenPurchaseOrders', async () => []),
    mock.method(workspaceTodayQueries, 'listFailedInvoiceSyncs', async () => overrides.failedInvoiceSyncs ?? []),
    mock.method(workspaceTodayQueries, 'listPendingInvoiceSyncs', async () => []),
    mock.method(workspaceTodayQueries, 'listOpenReworkIssues', async () => []),
    mock.method(workspaceTodayQueries, 'listOverdueTrainingAssignments', async () => []),
    mock.method(workspaceTodayQueries, 'listRecentAuditEvents', async () => []),
  ];
}

test('GET /workspace/today returns a role-filtered manager action queue', async () => {
  const mocks = mockTodayQueries({
    blockedWorkOrders: [
      {
        id: 'wo-1',
        workOrderNumber: 'WO-100',
        title: 'Battery tray install',
        priority: 1,
        dueAt: now,
        updatedAt: now,
      },
    ],
    shortageParts: [
      {
        id: 'part-1',
        sku: 'GG-BATT-001',
        name: 'Battery Pack',
        variant: null,
        reorderPoint: 4,
        onHand: 1,
        shortfall: 3,
      },
    ],
    failedInvoiceSyncs: [
      {
        id: 'sync-1',
        invoiceNumber: 'INV-100',
        state: 'FAILED',
        attemptCount: 4,
        lastErrorMessage: 'QBO rejected payload',
        createdAt: now,
      },
    ],
  });

  try {
    const response = await getWorkspaceTodayHandler({
      httpMethod: 'GET',
      queryStringParameters: { role: 'manager' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as WorkspaceTodayResponse;

    assert.equal(body.role, 'manager');
    assert.equal(body.summary.total, 2);
    assert.equal(body.summary.p1, 2);
    assert.deepEqual(body.items.map((item) => item.sourceType), ['work_order', 'part']);
    assert.ok(body.items.every((item) => item.module !== 'accounting'));
  } finally {
    for (const item of mocks) item.mock.restore();
  }
});

test('GET /workspace/today keeps partial results when one source fails', async () => {
  const mocks = mockTodayQueries({
    shortageParts: new Error('inventory read failed'),
    failedInvoiceSyncs: [
      {
        id: 'sync-1',
        invoiceNumber: 'INV-100',
        state: 'FAILED',
        attemptCount: 2,
        lastErrorMessage: null,
        createdAt: now,
      },
    ],
  });

  try {
    const response = await getWorkspaceTodayHandler({
      httpMethod: 'GET',
      queryStringParameters: { role: 'accounting' },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as WorkspaceTodayResponse;

    assert.equal(body.role, 'accounting');
    assert.equal(body.summary.total, 1);
    assert.equal(body.items[0]?.sourceType, 'invoice_sync');
    assert.equal(body.warnings.length, 1);
    assert.equal(body.warnings[0]?.source, 'inventory.shortages');
  } finally {
    for (const item of mocks) item.mock.restore();
  }
});
