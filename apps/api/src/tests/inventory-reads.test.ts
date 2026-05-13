import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  consumeReservationHandler,
  approvePurchaseOrderHandler,
  cancelPurchaseOrderHandler,
  closePurchaseOrderHandler,
  createPurchaseOrderHandler,
  createReservationHandler,
  getPurchaseOrderHandler,
  getVendorHandler,
  inventoryLotQueries,
  inventoryPlanningQueries,
  inventoryPurchaseOrderCommands,
  inventoryPurchaseOrderQueries,
  inventoryReservationQueries,
  listLotsHandler,
  listPurchaseOrdersHandler,
  listReservationsHandler,
  planMaterialByStageHandler,
  receiveInventoryLotHandler,
  releaseReservationHandler,
  sendPurchaseOrderHandler,
  updatePurchaseOrderHandler,
} from '../lambda/inventory/handlers.js';

const STOCK_LOT_ID = '00000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000002';
const WORK_ORDER_PART_ID = '00000000-0000-4000-8000-000000000003';
const RESERVATION_ID = '00000000-0000-4000-8000-000000000004';
const PART_ID = '00000000-0000-4000-8000-000000000005';
const PURCHASE_ORDER_LINE_ID = '00000000-0000-4000-8000-000000000007';
const PURCHASE_ORDER_ID = '00000000-0000-4000-8000-000000000008';
const VENDOR_ID = '00000000-0000-4000-8000-000000000009';
const UOM_ID = '00000000-0000-4000-8000-000000000010';

test('planMaterialByStageHandler returns replenishment recommendations', async () => {
  const planMock = mock.method(inventoryPlanningQueries, 'getMaterialPlanByStage', async () => ({
    generatedAt: '2026-05-12T12:00:00.000Z',
    groups: [
      {
        installStage: 'WIRING',
        totalShortfall: 3,
        lines: [
          {
            part: {
              id: PART_ID,
              sku: 'BRK-001',
              name: 'Brake Pad',
              unitOfMeasure: 'EA',
              partState: 'ACTIVE',
              reorderPoint: 5,
              defaultVendorId: VENDOR_ID,
              defaultVendorName: 'Acme Parts',
              quantityOnHand: 2,
              quantityReserved: 1,
              quantityAvailable: 1,
            },
            onHand: 2,
            reserved: 1,
            available: 1,
            reorderPoint: 5,
            shortfall: 3,
          },
        ],
      },
    ],
    unassigned: [],
    replenishment: {
      summary: {
        recommendationCount: 1,
        vendorGroupCount: 1,
        partsNeedingVendor: 0,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        totalRecommendedQuantity: 4,
        estimatedCost: 102,
      },
      recommendations: [
        {
          part: {
            id: PART_ID,
            sku: 'BRK-001',
            name: 'Brake Pad',
            unitOfMeasure: 'EA',
            partState: 'ACTIVE',
            reorderPoint: 5,
            defaultVendorId: VENDOR_ID,
            defaultVendorName: 'Acme Parts',
          },
          vendorId: VENDOR_ID,
          vendorName: 'Acme Parts',
          vendorState: 'ACTIVE',
          leadTimeDays: 7,
          onHand: 2,
          reserved: 1,
          available: 1,
          reorderPoint: 5,
          inboundQuantity: 0,
          draftQuantity: 0,
          projectedAvailable: 1,
          shortfall: 4,
          recommendedOrderQuantity: 4,
          openPurchaseOrderCount: 0,
          estimatedUnitCost: 25.5,
          severity: 'high',
          reason: 'Available inventory is below the reorder point and has no inbound cover.',
        },
      ],
      vendorGroups: [
        {
          vendorId: VENDOR_ID,
          vendorName: 'Acme Parts',
          vendorState: 'ACTIVE',
          leadTimeDays: 7,
          recommendations: [],
          totalRecommendedQuantity: 4,
          estimatedSubtotal: 102,
        },
      ],
    },
  }));

  try {
    const response = await planMaterialByStageHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    assert.equal(planMock.mock.calls.length, 1);
    const payload = JSON.parse(response.body) as {
      replenishment: {
        summary: { recommendationCount: number; totalRecommendedQuantity: number };
        recommendations: Array<{ part: { sku: string }; recommendedOrderQuantity: number }>;
      };
    };
    assert.equal(payload.replenishment.summary.recommendationCount, 1);
    assert.equal(payload.replenishment.summary.totalRecommendedQuantity, 4);
    assert.equal(payload.replenishment.recommendations[0].part.sku, 'BRK-001');
    assert.equal(payload.replenishment.recommendations[0].recommendedOrderQuantity, 4);
  } finally {
    planMock.mock.restore();
  }
});

const reservationPayload = {
  id: RESERVATION_ID,
  status: 'ACTIVE' as const,
  reservedQuantity: 2,
  consumedQuantity: 0,
  allocatedQuantity: 0,
  openQuantity: 2,
  reservationPriority: 100,
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-01T12:00:00.000Z',
  partId: PART_ID,
  partSku: 'BRK-001',
  partName: 'Brake Pad',
  unitOfMeasure: 'EA',
  stockLocationId: '00000000-0000-4000-8000-000000000006',
  locationName: 'Main Warehouse',
  stockLotId: STOCK_LOT_ID,
  lotNumber: 'LOT-100',
  workOrderId: WORK_ORDER_ID,
  workOrderNumber: 'WO-100',
  workOrderPartId: WORK_ORDER_PART_ID,
};

function purchaseOrderPayload(state = 'DRAFT') {
  return {
    id: PURCHASE_ORDER_ID,
    poNumber: 'PO-2026-001',
    vendorId: VENDOR_ID,
    purchaseOrderState: state,
    orderedAt: new Date('2026-03-01T12:00:00.000Z'),
    expectedAt: new Date('2026-03-15T12:00:00.000Z'),
    sentAt: state === 'SENT' ? new Date('2026-03-02T10:00:00.000Z') : null,
    closedAt:
      state === 'RECEIVED' || state === 'CANCELLED' ? new Date('2026-03-16T10:00:00.000Z') : null,
    notes: 'Urgent order',
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    updatedAt: new Date('2026-03-02T10:00:00.000Z'),
    vendor: { vendorName: 'Acme Parts', vendorCode: 'ACME' },
    lines: [
      {
        id: PURCHASE_ORDER_LINE_ID,
        lineNumber: 1,
        partId: PART_ID,
        part: {
          sku: 'BRK-001',
          name: 'Brake Pad',
          defaultLocationId: 'loc-1',
          defaultLocation: { locationName: 'Main Warehouse' },
        },
        orderedQuantity: '10.000',
        receivedQuantity: state === 'RECEIVED' ? '10.000' : '0.000',
        rejectedQuantity: '0.000',
        unitCost: '25.5000',
        promisedAt: new Date('2026-03-14T12:00:00.000Z'),
        lineState: state === 'CANCELLED' ? 'CANCELLED' : state === 'RECEIVED' ? 'RECEIVED' : 'OPEN',
        unitOfMeasure: { uomCode: 'EA', uomName: 'Each' },
      },
    ],
  };
}

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

test('receiveInventoryLotHandler validates and receives a purchase order line', async () => {
  const receiveLotMock = mock.method(inventoryLotQueries, 'receivePurchaseOrderLine', async () => ({
    lot: {
      id: STOCK_LOT_ID,
      lotNumber: 'LOT-RCV-1',
      lotState: 'AVAILABLE',
      partSku: 'BRK-001',
      partName: 'Brake Pad',
      locationName: 'Main Warehouse',
      quantityOnHand: 4,
      quantityReserved: 0,
      quantityAllocated: 0,
      quantityConsumed: 0,
      quantityAvailable: 4,
      receivedAt: '2026-05-04T12:00:00.000Z',
      createdAt: '2026-05-04T12:00:00.000Z',
      updatedAt: '2026-05-04T12:00:00.000Z',
    },
    purchaseOrderLine: {
      id: PURCHASE_ORDER_LINE_ID,
      lineState: 'PARTIALLY_RECEIVED',
      receivedQuantity: 4,
      rejectedQuantity: 0,
    },
    purchaseOrderState: 'PARTIALLY_RECEIVED',
  }));

  try {
    const response = await receiveInventoryLotHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'receive-correlation' },
      body: JSON.stringify({
        purchaseOrderLineId: PURCHASE_ORDER_LINE_ID,
        quantity: 4,
        lotNumber: 'LOT-RCV-1',
      }),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(receiveLotMock.mock.calls.length, 1);
    assert.deepEqual(receiveLotMock.mock.calls[0].arguments[0], {
      purchaseOrderLineId: PURCHASE_ORDER_LINE_ID,
      quantity: 4,
      lotNumber: 'LOT-RCV-1',
    });
    assert.equal(receiveLotMock.mock.calls[0].arguments[1], 'receive-correlation');

    const payload = JSON.parse(response.body) as {
      lot: { id: string; quantityOnHand: number };
      purchaseOrderLine: { id: string; lineState: string };
      purchaseOrderState: string;
    };
    assert.equal(payload.lot.id, STOCK_LOT_ID);
    assert.equal(payload.lot.quantityOnHand, 4);
    assert.equal(payload.purchaseOrderLine.id, PURCHASE_ORDER_LINE_ID);
    assert.equal(payload.purchaseOrderLine.lineState, 'PARTIALLY_RECEIVED');
    assert.equal(payload.purchaseOrderState, 'PARTIALLY_RECEIVED');
  } finally {
    receiveLotMock.mock.restore();
  }
});

test('receiveInventoryLotHandler rejects invalid receipt quantities', async () => {
  const receiveLotMock = mock.method(inventoryLotQueries, 'receivePurchaseOrderLine', async () => {
    throw new Error('should not be called');
  });

  try {
    const response = await receiveInventoryLotHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ purchaseOrderLineId: PURCHASE_ORDER_LINE_ID, quantity: 0 }),
    });

    assert.equal(response.statusCode, 422);
    assert.equal(receiveLotMock.mock.calls.length, 0);
  } finally {
    receiveLotMock.mock.restore();
  }
});

// ─── Inventory Reservations ─────────────────────────────────────────────────

test('listReservationsHandler forwards filters to the reservation query layer', async () => {
  const listReservationsMock = mock.method(
    inventoryReservationQueries,
    'listReservations',
    async () => ({
      items: [reservationPayload],
      total: 1,
      page: 2,
      pageSize: 25,
    }),
  );

  try {
    const response = await listReservationsHandler({
      httpMethod: 'GET',
      queryStringParameters: {
        status: 'ALL',
        workOrderId: WORK_ORDER_ID,
        partId: PART_ID,
        search: 'BRK',
        page: '2',
        pageSize: '25',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listReservationsMock.mock.calls.length, 1);

    const callArgs = listReservationsMock.mock.calls[0].arguments[0] as {
      status?: string;
      workOrderId?: string;
      partId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    };
    assert.equal(callArgs.status, 'ALL');
    assert.equal(callArgs.workOrderId, WORK_ORDER_ID);
    assert.equal(callArgs.partId, PART_ID);
    assert.equal(callArgs.search, 'BRK');
    assert.equal(callArgs.page, 2);
    assert.equal(callArgs.pageSize, 25);

    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; partSku: string; openQuantity: number }>;
      total: number;
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].id, RESERVATION_ID);
    assert.equal(payload.items[0].partSku, 'BRK-001');
    assert.equal(payload.items[0].openQuantity, 2);
  } finally {
    listReservationsMock.mock.restore();
  }
});

test('createReservationHandler validates and creates a reservation', async () => {
  const createReservationMock = mock.method(
    inventoryReservationQueries,
    'createReservation',
    async () => reservationPayload,
  );

  try {
    const response = await createReservationHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'test-correlation' },
      body: JSON.stringify({
        stockLotId: STOCK_LOT_ID,
        quantity: 2,
        workOrderId: WORK_ORDER_ID,
        workOrderPartId: WORK_ORDER_PART_ID,
      }),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(createReservationMock.mock.calls.length, 1);
    assert.deepEqual(createReservationMock.mock.calls[0].arguments[0], {
      stockLotId: STOCK_LOT_ID,
      quantity: 2,
      workOrderId: WORK_ORDER_ID,
      workOrderPartId: WORK_ORDER_PART_ID,
    });
    assert.equal(createReservationMock.mock.calls[0].arguments[1], 'test-correlation');

    const payload = JSON.parse(response.body) as { reservation: { id: string; status: string } };
    assert.equal(payload.reservation.id, RESERVATION_ID);
    assert.equal(payload.reservation.status, 'ACTIVE');
  } finally {
    createReservationMock.mock.restore();
  }
});

test('createReservationHandler rejects invalid reservation quantities', async () => {
  const createReservationMock = mock.method(
    inventoryReservationQueries,
    'createReservation',
    async () => reservationPayload,
  );

  try {
    const response = await createReservationHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ stockLotId: STOCK_LOT_ID, quantity: 0 }),
    });

    assert.equal(response.statusCode, 422);
    assert.equal(createReservationMock.mock.calls.length, 0);
  } finally {
    createReservationMock.mock.restore();
  }
});

test('releaseReservationHandler and consumeReservationHandler dispatch reservation actions', async () => {
  const releaseReservationMock = mock.method(
    inventoryReservationQueries,
    'releaseReservation',
    async () => ({ ...reservationPayload, status: 'RELEASED' as const, openQuantity: 0 }),
  );
  const consumeReservationMock = mock.method(
    inventoryReservationQueries,
    'consumeReservation',
    async () => ({
      ...reservationPayload,
      status: 'CONSUMED' as const,
      consumedQuantity: 2,
      openQuantity: 0,
    }),
  );

  try {
    const releaseResponse = await releaseReservationHandler({
      httpMethod: 'PATCH',
      headers: { 'x-correlation-id': 'release-correlation' },
      pathParameters: { id: RESERVATION_ID },
      body: JSON.stringify({ quantity: 1 }),
    });
    const consumeResponse = await consumeReservationHandler({
      httpMethod: 'PATCH',
      headers: { 'x-correlation-id': 'consume-correlation' },
      pathParameters: { id: RESERVATION_ID },
    });

    assert.equal(releaseResponse.statusCode, 200);
    assert.equal(consumeResponse.statusCode, 200);
    assert.equal(releaseReservationMock.mock.calls[0].arguments[0], RESERVATION_ID);
    assert.deepEqual(releaseReservationMock.mock.calls[0].arguments[1], { quantity: 1 });
    assert.equal(releaseReservationMock.mock.calls[0].arguments[2], 'release-correlation');
    assert.equal(consumeReservationMock.mock.calls[0].arguments[0], RESERVATION_ID);
    assert.deepEqual(consumeReservationMock.mock.calls[0].arguments[1], {});
    assert.equal(consumeReservationMock.mock.calls[0].arguments[2], 'consume-correlation');
  } finally {
    releaseReservationMock.mock.restore();
    consumeReservationMock.mock.restore();
  }
});

// ─── List Purchase Orders ─────────────────────────────────────────────────────

test('listPurchaseOrdersHandler returns paginated purchase orders', async () => {
  const listPoMock = mock.method(inventoryPurchaseOrderQueries, 'listPurchaseOrders', async () => ({
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
  }));

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

test('getPurchaseOrderHandler returns a purchase-order detail contract', async () => {
  const getPoMock = mock.method(inventoryPurchaseOrderQueries, 'getPurchaseOrder', async () => ({
    id: 'po-1',
    poNumber: 'PO-2026-001',
    vendorId: 'vendor-1',
    purchaseOrderState: 'PARTIALLY_RECEIVED',
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
        part: {
          sku: 'BRK-001',
          name: 'Brake Pad',
          defaultLocationId: 'loc-1',
          defaultLocation: { locationName: 'Main Warehouse' },
        },
        orderedQuantity: '10.000',
        receivedQuantity: '4.000',
        rejectedQuantity: '1.000',
        unitCost: '25.5000',
        promisedAt: new Date('2026-03-14T12:00:00.000Z'),
        lineState: 'OPEN',
        unitOfMeasure: { uomCode: 'EA', uomName: 'Each' },
      },
    ],
  }));

  try {
    const response = await getPurchaseOrderHandler({
      httpMethod: 'GET',
      pathParameters: { id: 'po-1' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(getPoMock.mock.calls[0].arguments[0], 'po-1');

    const payload = JSON.parse(response.body) as {
      purchaseOrder: {
        poNumber: string;
        purchaseOrderState: string;
        vendorName: string;
        lines: Array<{
          openQuantity: number;
          unitOfMeasure: string;
          lineTotal: number;
          promisedAt: string;
        }>;
      };
    };

    assert.equal(payload.purchaseOrder.poNumber, 'PO-2026-001');
    assert.equal(payload.purchaseOrder.purchaseOrderState, 'PARTIALLY_RECEIVED');
    assert.equal(payload.purchaseOrder.vendorName, 'Acme Parts');
    assert.equal(payload.purchaseOrder.lines[0].openQuantity, 5);
    assert.equal(payload.purchaseOrder.lines[0].unitOfMeasure, 'EA');
    assert.equal(payload.purchaseOrder.lines[0].lineTotal, 255);
    assert.equal(payload.purchaseOrder.lines[0].promisedAt, '2026-03-14T12:00:00.000Z');
  } finally {
    getPoMock.mock.restore();
  }
});

test('getPurchaseOrderHandler returns 404 when missing', async () => {
  const getPoMock = mock.method(
    inventoryPurchaseOrderQueries,
    'getPurchaseOrder',
    async () => null,
  );

  try {
    const response = await getPurchaseOrderHandler({
      httpMethod: 'GET',
      pathParameters: { id: 'missing-po' },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    getPoMock.mock.restore();
  }
});

test('createPurchaseOrderHandler validates and creates a draft purchase order', async () => {
  const createPoMock = mock.method(
    inventoryPurchaseOrderCommands,
    'createPurchaseOrder',
    async () => purchaseOrderPayload('DRAFT'),
  );

  try {
    const response = await createPurchaseOrderHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'po-create-correlation' },
      body: JSON.stringify({
        vendorId: VENDOR_ID,
        expectedAt: '2026-03-15T12:00:00.000Z',
        notes: 'Urgent order',
        lines: [
          {
            partId: PART_ID,
            orderedQuantity: 10,
            unitCost: 25.5,
            unitOfMeasureId: UOM_ID,
            promisedAt: '2026-03-14T12:00:00.000Z',
          },
        ],
      }),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(createPoMock.mock.calls.length, 1);
    assert.deepEqual(createPoMock.mock.calls[0].arguments[0], {
      vendorId: VENDOR_ID,
      expectedAt: '2026-03-15T12:00:00.000Z',
      notes: 'Urgent order',
      lines: [
        {
          partId: PART_ID,
          orderedQuantity: 10,
          unitCost: 25.5,
          unitOfMeasureId: UOM_ID,
          promisedAt: '2026-03-14T12:00:00.000Z',
        },
      ],
    });
    assert.equal(createPoMock.mock.calls[0].arguments[1], 'po-create-correlation');

    const payload = JSON.parse(response.body) as {
      purchaseOrder: {
        poNumber: string;
        purchaseOrderState: string;
        lines: Array<{ partId: string }>;
      };
    };
    assert.equal(payload.purchaseOrder.poNumber, 'PO-2026-001');
    assert.equal(payload.purchaseOrder.purchaseOrderState, 'DRAFT');
    assert.equal(payload.purchaseOrder.lines[0].partId, PART_ID);
  } finally {
    createPoMock.mock.restore();
  }
});

test('createPurchaseOrderHandler rejects missing lines before command dispatch', async () => {
  const createPoMock = mock.method(
    inventoryPurchaseOrderCommands,
    'createPurchaseOrder',
    async () => purchaseOrderPayload('DRAFT'),
  );

  try {
    const response = await createPurchaseOrderHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ vendorId: VENDOR_ID, lines: [] }),
    });

    assert.equal(response.statusCode, 422);
    assert.equal(createPoMock.mock.calls.length, 0);
  } finally {
    createPoMock.mock.restore();
  }
});

test('updatePurchaseOrderHandler edits draft header and line payloads', async () => {
  const updatePoMock = mock.method(
    inventoryPurchaseOrderCommands,
    'updatePurchaseOrder',
    async () => purchaseOrderPayload('DRAFT'),
  );

  try {
    const response = await updatePurchaseOrderHandler({
      httpMethod: 'PATCH',
      headers: { 'x-correlation-id': 'po-update-correlation' },
      pathParameters: { id: PURCHASE_ORDER_ID },
      body: JSON.stringify({
        notes: 'Repriced before approval',
        lines: [{ id: PURCHASE_ORDER_LINE_ID, partId: PART_ID, orderedQuantity: 12, unitCost: 24 }],
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(updatePoMock.mock.calls[0].arguments[0], PURCHASE_ORDER_ID);
    assert.deepEqual(updatePoMock.mock.calls[0].arguments[1], {
      notes: 'Repriced before approval',
      lines: [{ id: PURCHASE_ORDER_LINE_ID, partId: PART_ID, orderedQuantity: 12, unitCost: 24 }],
    });
    assert.equal(updatePoMock.mock.calls[0].arguments[2], 'po-update-correlation');
  } finally {
    updatePoMock.mock.restore();
  }
});

test('purchase-order transition handlers dispatch lifecycle actions', async () => {
  const transitionMock = mock.method(
    inventoryPurchaseOrderCommands,
    'transitionPurchaseOrder',
    async (_id: string, action: string) =>
      purchaseOrderPayload(
        action === 'approve'
          ? 'APPROVED'
          : action === 'send'
            ? 'SENT'
            : action === 'cancel'
              ? 'CANCELLED'
              : 'RECEIVED',
      ),
  );

  try {
    const baseEvent = {
      httpMethod: 'PATCH',
      headers: { 'x-correlation-id': 'po-transition-correlation' },
      pathParameters: { id: PURCHASE_ORDER_ID },
    };
    const approve = await approvePurchaseOrderHandler(baseEvent);
    const send = await sendPurchaseOrderHandler(baseEvent);
    const cancel = await cancelPurchaseOrderHandler(baseEvent);
    const close = await closePurchaseOrderHandler(baseEvent);

    assert.equal(approve.statusCode, 200);
    assert.equal(send.statusCode, 200);
    assert.equal(cancel.statusCode, 200);
    assert.equal(close.statusCode, 200);
    assert.deepEqual(
      transitionMock.mock.calls.map((call) => call.arguments.slice(0, 3)),
      [
        [PURCHASE_ORDER_ID, 'approve', 'po-transition-correlation'],
        [PURCHASE_ORDER_ID, 'send', 'po-transition-correlation'],
        [PURCHASE_ORDER_ID, 'cancel', 'po-transition-correlation'],
        [PURCHASE_ORDER_ID, 'close', 'po-transition-correlation'],
      ],
    );
  } finally {
    transitionMock.mock.restore();
  }
});

test('listPurchaseOrdersHandler returns empty page when no orders match', async () => {
  const listPoMock = mock.method(inventoryPurchaseOrderQueries, 'listPurchaseOrders', async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  }));

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

test('getVendorHandler returns vendor procurement summary fields', async () => {
  const getVendorMock = mock.method(inventoryPurchaseOrderQueries, 'getVendor', async () => ({
    id: 'vendor-1',
    vendorCode: 'ACME',
    vendorName: 'Acme Parts',
    vendorState: 'ACTIVE',
    email: 'orders@example.com',
    phone: '555-0100',
    leadTimeDays: 7,
    paymentTerms: 'NET30',
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    updatedAt: new Date('2026-03-02T10:00:00.000Z'),
    purchaseOrders: [
      {
        id: 'po-open',
        purchaseOrderState: 'SENT',
        expectedAt: new Date('2026-03-15T12:00:00.000Z'),
      },
      {
        id: 'po-done',
        purchaseOrderState: 'RECEIVED',
        expectedAt: new Date('2026-03-10T12:00:00.000Z'),
      },
    ],
  }));

  try {
    const response = await getVendorHandler({
      httpMethod: 'GET',
      pathParameters: { id: 'vendor-1' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(getVendorMock.mock.calls[0].arguments[0], 'vendor-1');

    const payload = JSON.parse(response.body) as {
      vendor: {
        vendorCode: string;
        openPurchaseOrderCount: number;
        nextExpectedAt: string;
      };
    };
    assert.equal(payload.vendor.vendorCode, 'ACME');
    assert.equal(payload.vendor.openPurchaseOrderCount, 1);
    assert.equal(payload.vendor.nextExpectedAt, '2026-03-15T12:00:00.000Z');
  } finally {
    getVendorMock.mock.restore();
  }
});
