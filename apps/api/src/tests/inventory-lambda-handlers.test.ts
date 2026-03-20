import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { inventoryLotQueries, listLotsHandler } from '../lambda/inventory/handlers.js';

test('listLotsHandler returns inventory lot summaries for the web contract', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listAvailableLots', async () => [
    {
      id: 'lot-1',
      lotNumber: 'LOT-001',
      quantityOnHand: '12',
      quantityReserved: '4',
    },
    {
      id: 'lot-2',
      lotNumber: null,
      quantityOnHand: 3,
      quantityReserved: 0,
    },
  ]);

  try {
    const response = await listLotsHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    assert.equal(listLotsMock.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as Array<{
      id: string;
      lotNumber: string;
      quantityOnHand: number;
      quantityReserved: number;
    }>;

    assert.deepEqual(payload, [
      {
        id: 'lot-1',
        lotNumber: 'LOT-001',
        quantityOnHand: 12,
        quantityReserved: 4,
      },
      {
        id: 'lot-2',
        lotNumber: 'lot-2',
        quantityOnHand: 3,
        quantityReserved: 0,
      },
    ]);
  } finally {
    listLotsMock.mock.restore();
  }
});

test('listLotsHandler returns an empty array when no lots are available', async () => {
  const listLotsMock = mock.method(inventoryLotQueries, 'listAvailableLots', async () => []);

  try {
    const response = await listLotsHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as unknown[];
    assert.deepEqual(payload, []);
  } finally {
    listLotsMock.mock.restore();
  }
});