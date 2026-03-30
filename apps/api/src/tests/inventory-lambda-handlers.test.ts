import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { inventoryLotQueries, listLotsHandler } from '../lambda/inventory/handlers.js';

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