import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  inventoryLotQueries,
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
