import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  inventoryLotQueries,
  inventoryPurchaseOrderQueries,
  listLotsHandler,
  listPurchaseOrdersHandler,
} from '../lambda/inventory/handlers.js';

// ─── List Lots ────────────────────────────────────────────────────────────────

test('listLotsHandler forwards query-string filters to the query layer', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listLots', async () => ({
    items: [
      {
        id: 'lot-1',
        lotNumber: 'LOT-100',
        serialNumber: null,
        lotState: 'AVAILABLE',
        receivedAt: new Date('2026-02-01T09:00:00.000Z'),
        expiresAt: null,
        createdAt: new Date('2026-02-01T09:00:00.000Z'),
        updatedAt: new Date('2026-02-01T09:00:00.000Z'),
        part: { sku: 'BRK-001', name: 'Brake Pad' },
        stockLocation: { locationName: 'Main Warehouse' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  }));

  try {
    const response = await listLotsHandler({
      httpMethod: 'GET',
      queryStringParameters: {
        partNumber: 'BRK',
        warehouseId: 'wh-1',
        status: 'AVAILABLE',
        page: '1',
        pageSize: '25',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listLotsMock.mock.calls.length, 1);

    const callArgs = listLotsMock.mock.calls[0].arguments[0] as {
      partNumber?: string;
      warehouseId?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    };
    assert.equal(callArgs.partNumber, 'BRK');
    assert.equal(callArgs.warehouseId, 'wh-1');
    assert.equal(callArgs.status, 'AVAILABLE');
    assert.equal(callArgs.page, 1);
    assert.equal(callArgs.pageSize, 25);

    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; partSku: string; locationName: string }>;
      total: number;
      page: number;
      pageSize: number;
    };

    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].id, 'lot-1');
    assert.equal(payload.items[0].partSku, 'BRK-001');
    assert.equal(payload.items[0].locationName, 'Main Warehouse');
    assert.equal(payload.total, 1);
    assert.equal(payload.page, 1);
    assert.equal(payload.pageSize, 25);
  } finally {
    listLotsMock.mock.restore();
  }
});

test('listLotsHandler defaults pagination when no query params provided', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listLots', async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  }));

  try {
    const response = await listLotsHandler({ httpMethod: 'GET' });
    assert.equal(response.statusCode, 200);

    const callArgs = listLotsMock.mock.calls[0].arguments[0] as {
      page?: number;
      pageSize?: number;
    };
    assert.equal(callArgs.page, 1);
    assert.equal(callArgs.pageSize, 50);
  } finally {
    listLotsMock.mock.restore();
  }
});

// ─── List Purchase Orders ─────────────────────────────────────────────────────

test('listPurchaseOrdersHandler returns paginated purchase orders', async () => {
  const listPoMock = mock.method(
    inventoryPurchaseOrderQueries,
    'listPurchaseOrders',
    async () => ({
      items: [
        {
          id: 'po-1',
          poNumber: 'PO-2026-001',
          vendorId: 'vendor-1',
          purchaseOrderState: 'SENT',
          orderedAt: new Date('2026-03-01T12:00:00.000Z'),
          expectedAt: new Date('2026-03-15T12:00:00.000Z'),
          sentAt: new Date('2026-03-02T10:00:00.000Z'),
          closedAt: null,
          notes: 'Urgent order',
          createdAt: new Date('2026-03-01T12:00:00.000Z'),
          updatedAt: new Date('2026-03-02T10:00:00.000Z'),
          vendor: { vendorName: 'Acme Parts', vendorCode: 'ACME' },
          lines: [
            {
              id: 'line-1',
              lineNumber: 1,
              partId: 'part-1',
              orderedQuantity: '10.000',
              receivedQuantity: '0.000',
              rejectedQuantity: '0.000',
              unitCost: '25.5000',
              lineState: 'OPEN',
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    }),
  );

  try {
    const response = await listPurchaseOrdersHandler({
      httpMethod: 'GET',
      queryStringParameters: { status: 'SENT', supplierId: 'vendor-1' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listPoMock.mock.calls.length, 1);

    const callArgs = listPoMock.mock.calls[0].arguments[0] as {
      status?: string;
      supplierId?: string;
    };
    assert.equal(callArgs.status, 'SENT');
    assert.equal(callArgs.supplierId, 'vendor-1');

    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        poNumber: string;
        vendorName: string;
        vendorCode: string;
        purchaseOrderState: string;
        lineCount: number;
        lines: Array<{
          orderedQuantity: number;
          receivedQuantity: number;
          unitCost: number;
        }>;
      }>;
      total: number;
    };

    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].poNumber, 'PO-2026-001');
    assert.equal(payload.items[0].vendorName, 'Acme Parts');
    assert.equal(payload.items[0].vendorCode, 'ACME');
    assert.equal(payload.items[0].purchaseOrderState, 'SENT');
    assert.equal(payload.items[0].lineCount, 1);
    assert.equal(payload.items[0].lines[0].orderedQuantity, 10);
    assert.equal(payload.items[0].lines[0].unitCost, 25.5);
    assert.equal(payload.total, 1);
  } finally {
    listPoMock.mock.restore();
  }
});

test('listPurchaseOrdersHandler returns empty page when no orders match', async () => {
  const listPoMock = mock.method(
    inventoryPurchaseOrderQueries,
    'listPurchaseOrders',
    async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    }),
  );

  try {
    const response = await listPurchaseOrdersHandler({ httpMethod: 'GET' });
    assert.equal(response.statusCode, 200);

    const payload = JSON.parse(response.body) as { items: unknown[]; total: number };
    assert.deepEqual(payload.items, []);
    assert.equal(payload.total, 0);
  } finally {
    listPoMock.mock.restore();
  }
});
