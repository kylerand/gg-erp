import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  inventoryLedgerQueries,
  inventoryLotQueries,
  listInventoryLedgerHandler,
  listLotsHandler,
  listPartsHandler,
  listVendorsHandler,
  setInventoryHandlerPrismaForTests,
  updatePartHandler,
} from '../lambda/inventory/handlers.js';

test('listLotsHandler returns inventory lot details for the web contract', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listLots', async () => ({
    items: [
      {
        id: 'lot-1',
        lotNumber: 'LOT-001',
        serialNumber: null,
        lotState: 'AVAILABLE',
        receivedAt: new Date('2026-01-15T10:00:00.000Z'),
        expiresAt: null,
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
        updatedAt: new Date('2026-01-15T10:00:00.000Z'),
        part: { sku: 'SKU-001', name: 'Brake Pad' },
        stockLocation: { locationName: 'Warehouse A' },
      },
      {
        id: 'lot-2',
        lotNumber: null,
        serialNumber: 'SN-123',
        lotState: 'QUARANTINED',
        receivedAt: new Date('2026-01-10T08:00:00.000Z'),
        expiresAt: new Date('2027-01-10T00:00:00.000Z'),
        createdAt: new Date('2026-01-10T08:00:00.000Z'),
        updatedAt: new Date('2026-01-10T08:00:00.000Z'),
        part: { sku: 'SKU-002', name: 'Oil Filter' },
        stockLocation: { locationName: 'Warehouse B' },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  }));

  try {
    const response = await listLotsHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    assert.equal(listLotsMock.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        lotNumber: string;
        lotState: string;
        partSku: string;
        partName: string;
        locationName: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    };

    assert.equal(payload.total, 2);
    assert.equal(payload.page, 1);
    assert.equal(payload.pageSize, 50);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0].lotNumber, 'LOT-001');
    assert.equal(payload.items[0].partSku, 'SKU-001');
    assert.equal(payload.items[0].locationName, 'Warehouse A');
    // fallback: when lotNumber is null, uses id
    assert.equal(payload.items[1].lotNumber, 'lot-2');
    assert.equal(payload.items[1].lotState, 'QUARANTINED');
  } finally {
    listLotsMock.mock.restore();
  }
});

test('listInventoryLedgerHandler forwards filters and returns movement history', async () => {
  const listLedgerMock = mock.method(
    inventoryLedgerQueries,
    'listLedger',
    async (filters: { limit?: number; offset?: number } = {}) => ({
      items: [
        {
          id: 'ledger-1',
          movementType: 'RECEIPT',
          quantityDelta: 4,
          unitCost: 125,
          valueDelta: 500,
          reasonCode: 'PURCHASE_ORDER_RECEIPT',
          sourceDocument: { type: 'PURCHASE_ORDER_LINE', id: 'pol-1' },
          correlationId: 'corr-1',
          createdAt: '2026-05-30T12:00:00.000Z',
          part: {
            id: '11111111-1111-4111-8111-111111111111',
            sku: 'GG-LIFT',
            name: 'Lift kit',
            unitOfMeasure: 'EA',
          },
          location: {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Main Warehouse',
          },
          lot: { id: '33333333-3333-4333-8333-333333333333', lotNumber: 'LOT-001' },
          purchaseOrder: {
            id: '44444444-4444-4444-8444-444444444444',
            number: 'PO-1001',
            lineId: 'pol-1',
          },
        },
      ],
      total: 1,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
      summary: [{ movementType: 'RECEIPT', entryCount: 1, quantityDelta: 4, valueDelta: 500 }],
    }),
  );

  try {
    const response = await listInventoryLedgerHandler({
      httpMethod: 'GET',
      queryStringParameters: {
        search: 'lift',
        movementType: 'receipt',
        partId: '11111111-1111-4111-8111-111111111111',
        stockLocationId: '22222222-2222-4222-8222-222222222222',
        limit: '25',
        offset: '10',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listLedgerMock.mock.calls.length, 1);
    const filters = listLedgerMock.mock.calls[0].arguments[0] as {
      search?: string;
      movementTypes?: string[];
      partId?: string;
      stockLocationId?: string;
      limit?: number;
      offset?: number;
    };
    assert.equal(filters.search, 'lift');
    assert.deepEqual(filters.movementTypes, ['RECEIPT']);
    assert.equal(filters.partId, '11111111-1111-4111-8111-111111111111');
    assert.equal(filters.stockLocationId, '22222222-2222-4222-8222-222222222222');
    assert.equal(filters.limit, 25);
    assert.equal(filters.offset, 10);

    const payload = JSON.parse(response.body) as {
      items: Array<{
        movementType: string;
        part: { sku: string };
        purchaseOrder?: { number?: string };
      }>;
      total: number;
      summary: Array<{ movementType: string; entryCount: number }>;
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].movementType, 'RECEIPT');
    assert.equal(payload.items[0].part.sku, 'GG-LIFT');
    assert.equal(payload.items[0].purchaseOrder?.number, 'PO-1001');
    assert.equal(payload.summary[0].entryCount, 1);
  } finally {
    listLedgerMock.mock.restore();
  }
});

test('listInventoryLedgerHandler rejects unsupported movement filters', async () => {
  const response = await listInventoryLedgerHandler({
    httpMethod: 'GET',
    queryStringParameters: { movementType: 'BAD_STATE' },
  });

  assert.equal(response.statusCode, 422);
  assert.match(response.body, /Unsupported inventory ledger movement type/);
});

test('listLotsHandler returns an empty page when no lots are available', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listLots', async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  }));

  try {
    const response = await listLotsHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as { items: unknown[]; total: number };
    assert.deepEqual(payload.items, []);
    assert.equal(payload.total, 0);
  } finally {
    listLotsMock.mock.restore();
  }
});

test('listPartsHandler returns 422 for invalid stock filter', async () => {
  const response = await listPartsHandler({
    httpMethod: 'GET',
    queryStringParameters: { stock: 'LOW' },
  });

  assert.equal(response.statusCode, 422);
  assert.match(response.body, /Invalid stock filter/);
});

test('updatePartHandler assigns an active default vendor to a part', async () => {
  const partId = '11111111-1111-4111-8111-111111111111';
  const vendorId = '22222222-2222-4222-8222-222222222222';
  const partFindFirst = mock.fn(async () => ({ id: partId }));
  const vendorFindFirst = mock.fn(async () => ({ id: vendorId }));
  const partUpdate = mock.fn(async (args: { data: { defaultVendorId?: string } }) => ({
    id: partId,
    sku: 'GG-MADJAX-LIFT',
    name: 'MadJax lift kit',
    description: null,
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 2,
    defaultVendorId: args.data.defaultVendorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    defaultVendor: { vendorName: 'MadJax' },
    stockLots: [],
  }));
  const prisma = {
    part: { findFirst: partFindFirst, update: partUpdate },
    vendor: { findFirst: vendorFindFirst },
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await updatePartHandler({
      httpMethod: 'PATCH',
      pathParameters: { id: partId },
      body: JSON.stringify({ defaultVendorId: vendorId }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(partFindFirst.mock.calls.length, 1);
    assert.equal(vendorFindFirst.mock.calls.length, 1);
    assert.equal(partUpdate.mock.calls.length, 1);

    const updateArgs = partUpdate.mock.calls[0].arguments[0] as {
      where: { id: string };
      data: { defaultVendorId?: string; version?: { increment: number } };
    };
    assert.equal(updateArgs.where.id, partId);
    assert.equal(updateArgs.data.defaultVendorId, vendorId);
    assert.deepEqual(updateArgs.data.version, { increment: 1 });

    const payload = JSON.parse(response.body) as {
      part: { id: string; defaultVendorId?: string; defaultVendorName?: string };
    };
    assert.equal(payload.part.id, partId);
    assert.equal(payload.part.defaultVendorId, vendorId);
    assert.equal(payload.part.defaultVendorName, 'MadJax');
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('updatePartHandler rejects missing or inactive default vendors', async () => {
  const partId = '11111111-1111-4111-8111-111111111111';
  const vendorId = '22222222-2222-4222-8222-222222222222';
  const partUpdate = mock.fn(async () => {
    throw new Error('part.update should not run for an invalid vendor');
  });
  const prisma = {
    part: { findFirst: mock.fn(async () => ({ id: partId })), update: partUpdate },
    vendor: { findFirst: mock.fn(async () => null) },
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await updatePartHandler({
      httpMethod: 'PATCH',
      pathParameters: { id: partId },
      body: JSON.stringify({ defaultVendorId: vendorId }),
    });

    assert.equal(response.statusCode, 422);
    assert.match(response.body, /Active vendor not found/);
    assert.equal(partUpdate.mock.calls.length, 0);
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('listVendorsHandler filters on the vendorState Prisma field', async () => {
  const findMany = mock.fn(async (_args: { where: { vendorState?: string; state?: string } }) => [
    {
      id: '22222222-2222-4222-8222-222222222222',
      vendorCode: 'MADJAX',
      vendorName: 'MadJax',
      vendorState: 'ACTIVE',
      email: 'orders@example.com',
      phone: null,
      leadTimeDays: 5,
      paymentTerms: 'NET30',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
  ]);
  const count = mock.fn(async () => 1);
  const prisma = {
    vendor: { findMany, count },
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await listVendorsHandler({
      httpMethod: 'GET',
      queryStringParameters: { state: 'ACTIVE' },
    });

    assert.equal(response.statusCode, 200);
    const findArgs = findMany.mock.calls[0].arguments[0] as {
      where: { vendorState?: string; state?: string };
    };
    assert.equal(findArgs.where.vendorState, 'ACTIVE');
    assert.equal(findArgs.where.state, undefined);

    const payload = JSON.parse(response.body) as { items: Array<{ vendorName: string }> };
    assert.equal(payload.items[0].vendorName, 'MadJax');
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});
