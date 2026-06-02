import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  createInventoryAdjustmentHandler,
  createCycleCountHandler,
  createInventoryTransferHandler,
  inventoryLedgerQueries,
  inventoryLocationQueries,
  inventoryLotQueries,
  listInventoryLocationsHandler,
  inventoryReservationQueries,
  listInventoryLedgerHandler,
  listLotsHandler,
  listPartsHandler,
  listVendorsHandler,
  setInventoryHandlerPrismaForTests,
  updatePartHandler,
} from '../lambda/inventory/handlers.js';

const TEST_STOCK_LOT_ID = '00000000-0000-4000-8000-000000000001';
const TEST_WORK_ORDER_ID = '00000000-0000-4000-8000-000000000002';
const TEST_WORK_ORDER_PART_ID = '00000000-0000-4000-8000-000000000003';
const TEST_RESERVATION_ID = '00000000-0000-4000-8000-000000000004';
const TEST_PART_ID = '00000000-0000-4000-8000-000000000005';
const TEST_LOCATION_ID = '00000000-0000-4000-8000-000000000006';
const TEST_DESTINATION_LOCATION_ID = '00000000-0000-4000-8000-000000000007';

function partValuationRows(
  partId = TEST_PART_ID,
  overrides: Partial<{
    quantityOnHand: string;
    quantityReserved: string;
    quantityAllocated: string;
    quantityConsumed: string;
    quantityAvailable: string;
    estimatedUnitCost: string;
    inventoryValue: string;
    shortfallQuantity: string;
    shortfallValue: string;
    valuationSource: 'LOT_LEDGER' | 'LATEST_PO' | 'NO_COST';
  }> = {},
) {
  return [
    {
      partId,
      quantityOnHand: '5.000',
      quantityReserved: '1.000',
      quantityAllocated: '0.000',
      quantityConsumed: '2.000',
      quantityAvailable: '4.000',
      estimatedUnitCost: '25.5000',
      inventoryValue: '127.5000',
      shortfallQuantity: '0.000',
      shortfallValue: '0.0000',
      valuationSource: 'LOT_LEDGER',
      ...overrides,
    },
  ];
}

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
        stockLocation: { id: TEST_LOCATION_ID, locationName: 'Warehouse A' },
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
        stockLocation: { id: TEST_DESTINATION_LOCATION_ID, locationName: 'Warehouse B' },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  }));

  try {
    const response = await listLotsHandler({
      httpMethod: 'GET',
      queryStringParameters: { partId: TEST_PART_ID, status: 'AVAILABLE' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listLotsMock.mock.calls.length, 1);
    const filters = listLotsMock.mock.calls[0].arguments[0] as {
      partId?: string;
      status?: string;
    };
    assert.equal(filters.partId, TEST_PART_ID);
    assert.equal(filters.status, 'AVAILABLE');

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

test('listLotsHandler rejects invalid part handoff filters', async () => {
  const response = await listLotsHandler({
    httpMethod: 'GET',
    queryStringParameters: { partId: 'not-a-uuid' },
  });

  assert.equal(response.statusCode, 422);
  assert.match(response.body, /partId must be a UUID/);
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

test('reservation mutations append inventory ledger consequences', async () => {
  const harness = createInventoryReservationLedgerHarness();
  setInventoryHandlerPrismaForTests(harness.prisma as never);

  try {
    await inventoryReservationQueries.createReservation(
      {
        stockLotId: TEST_STOCK_LOT_ID,
        quantity: 2,
        workOrderId: TEST_WORK_ORDER_ID,
        workOrderPartId: TEST_WORK_ORDER_PART_ID,
      },
      'create-correlation',
    );

    await inventoryReservationQueries.releaseReservation(
      TEST_RESERVATION_ID,
      { quantity: 1 },
      'release-correlation',
    );

    await inventoryReservationQueries.consumeReservation(
      TEST_RESERVATION_ID,
      {},
      'issue-correlation',
    );

    const ledgerCalls = harness.executeCalls.filter((call) =>
      call.sql.includes('INSERT INTO inventory.inventory_ledger_entries'),
    );
    assert.equal(ledgerCalls.length, 3);
    assert.ok(ledgerCalls.some((call) => call.values.includes('RESERVATION')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('INVENTORY_RESERVED')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('RELEASE')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('RESERVATION_RELEASED')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('ISSUE')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('RESERVATION_CONSUMED')));
    assert.ok(ledgerCalls.every((call) => call.values.includes('INVENTORY_RESERVATION')));

    const balanceUpdates = harness.queryCalls.filter((call) =>
      call.sql.includes('UPDATE inventory.inventory_balances'),
    );
    assert.equal(balanceUpdates.length, 3);
    assert.ok(balanceUpdates.every((call) => call.sql.includes('last_ledger_entry_id')));
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('createInventoryAdjustmentHandler posts balance and ledger consequences', async () => {
  const harness = createInventoryAdjustmentHarness();
  setInventoryHandlerPrismaForTests(harness.prisma as never);

  try {
    const response = await createInventoryAdjustmentHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'adjustment-correlation' },
      body: JSON.stringify({
        stockLotId: TEST_STOCK_LOT_ID,
        quantityDelta: -1,
        reasonCode: 'cycle_count',
        notes: 'Physical count correction',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      adjustment: { quantityDelta: number; countedQuantity: number; reasonCode: string };
    };
    assert.equal(payload.adjustment.quantityDelta, -1);
    assert.equal(payload.adjustment.countedQuantity, 4);
    assert.equal(payload.adjustment.reasonCode, 'CYCLE_COUNT');

    const ledgerCall = harness.executeCalls.find((call) =>
      call.sql.includes('INSERT INTO inventory.inventory_ledger_entries'),
    );
    assert.ok(ledgerCall);
    assert.ok(ledgerCall.values.includes('ADJUSTMENT'));
    assert.ok(ledgerCall.values.includes('INVENTORY_ADJUSTMENT_LINE'));
    assert.ok(ledgerCall.values.includes('CYCLE_COUNT'));

    const balanceUpdate = harness.queryCalls.find((call) =>
      call.sql.includes('UPDATE inventory.inventory_balances'),
    );
    assert.ok(balanceUpdate);
    assert.ok(balanceUpdate.sql.includes('quantity_on_hand = quantity_on_hand +'));
    assert.ok(balanceUpdate.sql.includes('last_ledger_entry_id'));
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('createInventoryAdjustmentHandler routes cost evidence without quantity movement', async () => {
  const harness = createInventoryAdjustmentHarness();
  setInventoryHandlerPrismaForTests(harness.prisma as never);

  try {
    const response = await createInventoryAdjustmentHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'cost-evidence-correlation' },
      body: JSON.stringify({
        adjustmentMode: 'COST_EVIDENCE',
        stockLotId: TEST_STOCK_LOT_ID,
        unitCost: 42.25,
        evidenceReference: 'Vendor receipt 1001',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      costEvidence: {
        quantityOnHand: number;
        unitCost: number;
        valueDelta: number;
        reasonCode: string;
      };
    };
    assert.equal(payload.costEvidence.quantityOnHand, 5);
    assert.equal(payload.costEvidence.unitCost, 42.25);
    assert.equal(payload.costEvidence.valueDelta, 211.25);
    assert.equal(payload.costEvidence.reasonCode, 'COST_EVIDENCE');

    const ledgerCall = harness.executeCalls.find((call) =>
      call.sql.includes('INSERT INTO inventory.inventory_ledger_entries'),
    );
    assert.ok(ledgerCall);
    assert.ok(ledgerCall.values.includes('COST_EVIDENCE'));
    assert.ok(ledgerCall.values.includes(0));
    assert.ok(ledgerCall.values.includes(42.25));
    assert.ok(ledgerCall.values.includes('INVENTORY_COST_EVIDENCE'));
    assert.ok(ledgerCall.values.includes('Vendor receipt 1001'));

    const balanceUpdate = harness.queryCalls.find((call) =>
      call.sql.includes('UPDATE inventory.inventory_balances'),
    );
    assert.ok(balanceUpdate);
    assert.ok(balanceUpdate.sql.includes('last_ledger_entry_id'));
    assert.equal(balanceUpdate.sql.includes('quantity_on_hand = quantity_on_hand +'), false);
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('listInventoryLocationsHandler returns pickable stock locations', async () => {
  const listLocationsMock = mock.method(inventoryLocationQueries, 'listLocations', async () => [
    {
      id: TEST_LOCATION_ID,
      locationCode: 'MAIN',
      locationName: 'Main Warehouse',
      locationType: 'WAREHOUSE',
      isPickable: true,
    },
    {
      id: TEST_DESTINATION_LOCATION_ID,
      locationCode: 'BAY-1',
      locationName: 'Bay 1',
      locationType: 'BAY',
      isPickable: true,
    },
  ]);

  try {
    const response = await listInventoryLocationsHandler({ httpMethod: 'GET' });

    assert.equal(response.statusCode, 200);
    assert.equal(listLocationsMock.mock.calls.length, 1);
    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; locationCode: string; locationName: string }>;
      total: number;
    };
    assert.equal(payload.total, 2);
    assert.equal(payload.items[0].locationCode, 'MAIN');
    assert.equal(payload.items[1].locationName, 'Bay 1');
  } finally {
    listLocationsMock.mock.restore();
  }
});

test('createInventoryTransferHandler posts transfer rows, balances, and ledger entries', async () => {
  const harness = createInventoryTransferHarness();
  setInventoryHandlerPrismaForTests(harness.prisma as never);

  try {
    const response = await createInventoryTransferHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'transfer-correlation' },
      body: JSON.stringify({
        stockLotId: TEST_STOCK_LOT_ID,
        quantity: 2,
        toStockLocationId: TEST_DESTINATION_LOCATION_ID,
        reasonCode: 'shop_move',
        notes: 'Move to install bay',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      transfer: {
        quantity: number;
        reasonCode: string;
        fromStockLotId: string;
        toStockLotId: string;
      };
    };
    assert.equal(payload.transfer.quantity, 2);
    assert.equal(payload.transfer.reasonCode, 'SHOP_MOVE');
    assert.equal(payload.transfer.fromStockLotId, TEST_STOCK_LOT_ID);
    assert.match(payload.transfer.toStockLotId, /^[0-9a-f-]{36}$/);

    const ledgerCalls = harness.executeCalls.filter((call) =>
      call.sql.includes('INSERT INTO inventory.inventory_ledger_entries'),
    );
    assert.equal(ledgerCalls.length, 2);
    assert.ok(ledgerCalls.some((call) => call.values.includes('TRANSFER_OUT')));
    assert.ok(ledgerCalls.some((call) => call.values.includes('TRANSFER_IN')));
    assert.ok(ledgerCalls.every((call) => call.values.includes('INVENTORY_TRANSFER_LINE')));
    assert.ok(ledgerCalls.every((call) => call.values.includes('SHOP_MOVE')));

    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.inventory_transfers'),
      ),
    );
    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.inventory_transfer_lines'),
      ),
    );
    assert.ok(
      harness.executeCalls.some((call) => call.sql.includes('INSERT INTO inventory.stock_lots')),
    );

    const sourceBalanceUpdate = harness.queryCalls.find((call) =>
      call.sql.includes('UPDATE inventory.inventory_balances'),
    );
    assert.ok(sourceBalanceUpdate);
    assert.ok(sourceBalanceUpdate.sql.includes('quantity_on_hand = quantity_on_hand -'));
    assert.ok(sourceBalanceUpdate.sql.includes('last_ledger_entry_id'));

    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.inventory_balances'),
      ),
    );
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('createCycleCountHandler posts count lines, variances, balances, and ledger entries', async () => {
  const harness = createCycleCountHarness();
  setInventoryHandlerPrismaForTests(harness.prisma as never);

  try {
    const response = await createCycleCountHandler({
      httpMethod: 'POST',
      headers: { 'x-correlation-id': 'cycle-count-correlation' },
      body: JSON.stringify({
        stockLocationId: TEST_LOCATION_ID,
        scheduledFor: '2026-05-31',
        notes: 'End of month bay count',
        lines: [
          {
            stockLotId: TEST_STOCK_LOT_ID,
            countedQuantity: 3,
            reasonCode: 'cycle_count',
          },
        ],
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      cycleCount: {
        lineCount: number;
        varianceCount: number;
        netQuantityDelta: number;
        lines: Array<{ varianceQuantity: number; reasonCode: string }>;
      };
    };
    assert.equal(payload.cycleCount.lineCount, 1);
    assert.equal(payload.cycleCount.varianceCount, 1);
    assert.equal(payload.cycleCount.netQuantityDelta, -2);
    assert.equal(payload.cycleCount.lines[0].varianceQuantity, -2);
    assert.equal(payload.cycleCount.lines[0].reasonCode, 'CYCLE_COUNT');

    assert.ok(
      harness.executeCalls.some((call) => call.sql.includes('INSERT INTO inventory.cycle_counts')),
    );
    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.cycle_count_lines'),
      ),
    );
    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.inventory_adjustments'),
      ),
    );
    assert.ok(
      harness.executeCalls.some((call) =>
        call.sql.includes('INSERT INTO inventory.inventory_adjustment_lines'),
      ),
    );

    const ledgerCall = harness.executeCalls.find((call) =>
      call.sql.includes('INSERT INTO inventory.inventory_ledger_entries'),
    );
    assert.ok(ledgerCall);
    assert.ok(ledgerCall.values.includes('CYCLE_COUNT'));
    assert.ok(ledgerCall.values.includes('CYCLE_COUNT_LINE'));

    const balanceUpdate = harness.queryCalls.find((call) =>
      call.sql.includes('UPDATE inventory.inventory_balances'),
    );
    assert.ok(balanceUpdate);
    assert.ok(balanceUpdate.sql.includes('quantity_on_hand ='));
    assert.ok(balanceUpdate.sql.includes('last_ledger_entry_id'));
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
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

test('listPartsHandler returns 422 for invalid valuation filters', async () => {
  const issueResponse = await listPartsHandler({
    httpMethod: 'GET',
    queryStringParameters: { valuationIssue: 'STALE_COST' },
  });
  const sourceResponse = await listPartsHandler({
    httpMethod: 'GET',
    queryStringParameters: { valuationSource: 'AVERAGE_COST' },
  });

  assert.equal(issueResponse.statusCode, 422);
  assert.match(issueResponse.body, /Invalid valuationIssue filter/);
  assert.equal(sourceResponse.statusCode, 422);
  assert.match(sourceResponse.body, /Invalid valuationSource filter/);
});

test('listPartsHandler returns balance-backed valuation rollups', async () => {
  const partId = TEST_PART_ID;
  const part = {
    id: partId,
    sku: 'GG-MADJAX-LIFT',
    name: 'MadJax lift kit',
    description: null,
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    stockLots: [],
  };
  const findMany = mock.fn(async (args: { take?: number; select?: { id?: boolean } }) =>
    args.select ? [{ id: partId }] : [part],
  );
  const queryRaw = mock.fn(async () => partValuationRows(partId));
  const prisma = {
    part: { findMany },
    $queryRaw: queryRaw,
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await listPartsHandler({
      httpMethod: 'GET',
      queryStringParameters: { limit: '25' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(findMany.mock.calls.length, 2);
    assert.equal(queryRaw.mock.calls.length, 1);

    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        quantityOnHand: number;
        quantityAvailable: number;
        estimatedUnitCost: number;
        inventoryValue: number;
        valuationSource: string;
      }>;
      total: number;
      valuationSummary: { totalInventoryValue: number; missingCostPartCount: number };
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].id, partId);
    assert.equal(payload.items[0].quantityOnHand, 5);
    assert.equal(payload.items[0].quantityAvailable, 4);
    assert.equal(payload.items[0].estimatedUnitCost, 25.5);
    assert.equal(payload.items[0].inventoryValue, 127.5);
    assert.equal(payload.items[0].valuationSource, 'LOT_LEDGER');
    assert.equal(payload.valuationSummary.totalInventoryValue, 127.5);
    assert.equal(payload.valuationSummary.missingCostPartCount, 0);
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('listPartsHandler applies valuation exception filters before pagination', async () => {
  const costedPartId = '00000000-0000-4000-8000-000000000051';
  const missingCostPartId = '00000000-0000-4000-8000-000000000052';
  const shortPartId = '00000000-0000-4000-8000-000000000053';
  const partById = new Map(
    [
      [costedPartId, 'AA-COSTED'],
      [missingCostPartId, 'BB-MISSING-COST'],
      [shortPartId, 'CC-SHORT'],
    ].map(([id, sku]) => [
      id,
      {
        id,
        sku,
        name: sku,
        description: null,
        unitOfMeasure: 'EA',
        partState: 'ACTIVE',
        reorderPoint: 2,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        stockLots: [],
      },
    ]),
  );
  const findMany = mock.fn(
    async (args: { select?: { id?: boolean }; where?: { id?: { in?: string[] } } }) => {
      if (args.select) {
        return [{ id: costedPartId }, { id: missingCostPartId }, { id: shortPartId }];
      }
      return (args.where?.id?.in ?? []).map((id) => partById.get(id));
    },
  );
  const queryRaw = mock.fn(async () => [
    ...partValuationRows(costedPartId),
    ...partValuationRows(missingCostPartId, {
      quantityOnHand: '2.000',
      quantityAvailable: '2.000',
      estimatedUnitCost: '0.0000',
      inventoryValue: '0.0000',
      valuationSource: 'NO_COST',
    }),
    ...partValuationRows(shortPartId, {
      quantityOnHand: '0.000',
      quantityAvailable: '0.000',
      estimatedUnitCost: '10.0000',
      inventoryValue: '0.0000',
      shortfallQuantity: '3.000',
      shortfallValue: '30.0000',
      valuationSource: 'LATEST_PO',
    }),
  ]);
  const prisma = {
    part: { findMany },
    $queryRaw: queryRaw,
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await listPartsHandler({
      httpMethod: 'GET',
      queryStringParameters: { valuationIssue: 'MISSING_COST', limit: '1' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(findMany.mock.calls.length, 2);
    const pageArgs = findMany.mock.calls[1]!.arguments[0] as { where: { id: { in: string[] } } };
    assert.deepEqual(pageArgs.where.id.in, [missingCostPartId]);

    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; valuationSource: string }>;
      total: number;
      valuationSummary: { missingCostPartCount: number; totalShortfallQuantity: number };
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].id, missingCostPartId);
    assert.equal(payload.items[0].valuationSource, 'NO_COST');
    assert.equal(payload.valuationSummary.missingCostPartCount, 1);
    assert.equal(payload.valuationSummary.totalShortfallQuantity, 0);
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('listPartsHandler applies valuation source filters', async () => {
  const noCostPartId = '00000000-0000-4000-8000-000000000061';
  const latestPoPartId = '00000000-0000-4000-8000-000000000062';
  const partById = new Map(
    [
      [noCostPartId, 'NO-COST'],
      [latestPoPartId, 'LATEST-PO'],
    ].map(([id, sku]) => [
      id,
      {
        id,
        sku,
        name: sku,
        description: null,
        unitOfMeasure: 'EA',
        partState: 'ACTIVE',
        reorderPoint: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        stockLots: [],
      },
    ]),
  );
  const findMany = mock.fn(
    async (args: { select?: { id?: boolean }; where?: { id?: { in?: string[] } } }) => {
      if (args.select) return [{ id: noCostPartId }, { id: latestPoPartId }];
      return (args.where?.id?.in ?? []).map((id) => partById.get(id));
    },
  );
  const queryRaw = mock.fn(async () => [
    ...partValuationRows(noCostPartId, { valuationSource: 'NO_COST' }),
    ...partValuationRows(latestPoPartId, { valuationSource: 'LATEST_PO' }),
  ]);
  const prisma = {
    part: { findMany },
    $queryRaw: queryRaw,
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await listPartsHandler({
      httpMethod: 'GET',
      queryStringParameters: { valuationSource: 'LATEST_PO' },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{ id: string; valuationSource: string }>;
      total: number;
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].id, latestPoPartId);
    assert.equal(payload.items[0].valuationSource, 'LATEST_PO');
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
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
    $queryRaw: mock.fn(async () => partValuationRows(partId)),
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
      part: {
        id: string;
        defaultVendorId?: string;
        defaultVendorName?: string;
        inventoryValue?: number;
      };
    };
    assert.equal(payload.part.id, partId);
    assert.equal(payload.part.defaultVendorId, vendorId);
    assert.equal(payload.part.defaultVendorName, 'MadJax');
    assert.equal(payload.part.inventoryValue, 127.5);
  } finally {
    setInventoryHandlerPrismaForTests(undefined);
  }
});

test('updatePartHandler edits core part fields', async () => {
  const partId = '11111111-1111-4111-8111-111111111111';
  const partFindFirst = mock.fn(async () => ({ id: partId }));
  const partUpdate = mock.fn(async (args: { data: Record<string, unknown> }) => ({
    id: partId,
    sku: 'GG-MADJAX-LIFT',
    name: args.data.name,
    description: args.data.description,
    unitOfMeasure: args.data.unitOfMeasure,
    partState: args.data.partState,
    category: args.data.category,
    installStage: args.data.installStage,
    lifecycleLevel: args.data.lifecycleLevel,
    reorderPoint: args.data.reorderPoint,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    stockLots: [],
  }));
  const prisma = {
    part: { findFirst: partFindFirst, update: partUpdate },
    vendor: { findFirst: mock.fn(async () => null) },
    $queryRaw: mock.fn(async () => partValuationRows(partId)),
  };
  setInventoryHandlerPrismaForTests(prisma as never);

  try {
    const response = await updatePartHandler({
      httpMethod: 'PATCH',
      pathParameters: { id: partId },
      body: JSON.stringify({
        name: '  MadJax lift kit XL  ',
        description: '',
        unitOfMeasure: 'ea',
        reorderPoint: 4,
        partState: 'INACTIVE',
        category: 'HARDWARE',
        installStage: null,
        lifecycleLevel: 'RAW_COMPONENT',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(partFindFirst.mock.calls.length, 1);
    assert.equal(partUpdate.mock.calls.length, 1);

    const updateArgs = partUpdate.mock.calls[0].arguments[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    assert.equal(updateArgs.where.id, partId);
    assert.equal(updateArgs.data.name, 'MadJax lift kit XL');
    assert.equal(updateArgs.data.description, null);
    assert.equal(updateArgs.data.unitOfMeasure, 'EA');
    assert.equal(updateArgs.data.reorderPoint, 4);
    assert.equal(updateArgs.data.partState, 'INACTIVE');
    assert.equal(updateArgs.data.category, 'HARDWARE');
    assert.equal(updateArgs.data.installStage, null);
    assert.equal(updateArgs.data.lifecycleLevel, 'RAW_COMPONENT');
    assert.deepEqual(updateArgs.data.version, { increment: 1 });

    const payload = JSON.parse(response.body) as {
      part: {
        name: string;
        description?: string;
        unitOfMeasure: string;
        partState: string;
        category?: string;
        installStage?: string;
        lifecycleLevel?: string;
        reorderPoint: number;
        inventoryValue?: number;
      };
    };
    assert.equal(payload.part.name, 'MadJax lift kit XL');
    assert.equal(payload.part.description, undefined);
    assert.equal(payload.part.unitOfMeasure, 'EA');
    assert.equal(payload.part.partState, 'INACTIVE');
    assert.equal(payload.part.category, 'HARDWARE');
    assert.equal(payload.part.installStage, undefined);
    assert.equal(payload.part.lifecycleLevel, 'RAW_COMPONENT');
    assert.equal(payload.part.reorderPoint, 4);
    assert.equal(payload.part.inventoryValue, 127.5);
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

interface RawSqlCall {
  sql: string;
  values: unknown[];
}

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

function reservationDetailRow() {
  return {
    id: TEST_RESERVATION_ID,
    status: 'ACTIVE',
    reservedQuantity: 2,
    consumedQuantity: 0,
    allocatedQuantity: 0,
    reservationPriority: 100,
    shortageReason: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    partId: TEST_PART_ID,
    partSku: 'GG-LIFT',
    partName: 'Lift kit',
    unitOfMeasure: 'EA',
    stockLocationId: TEST_LOCATION_ID,
    locationName: 'Main Warehouse',
    stockLotId: TEST_STOCK_LOT_ID,
    lotNumber: 'LOT-001',
    serialNumber: null,
    workOrderId: TEST_WORK_ORDER_ID,
    workOrderNumber: 'WO-1001',
    workOrderTitle: 'Test build',
    workOrderPartId: TEST_WORK_ORDER_PART_ID,
  };
}

function createInventoryReservationLedgerHarness() {
  const queryCalls: RawSqlCall[] = [];
  const executeCalls: RawSqlCall[] = [];

  const tx = {
    $queryRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      queryCalls.push({ sql, values });

      if (sql.includes('FROM inventory.stock_lots')) {
        return [
          {
            id: TEST_STOCK_LOT_ID,
            partId: TEST_PART_ID,
            stockLocationId: TEST_LOCATION_ID,
            lotState: 'AVAILABLE',
          },
        ];
      }

      if (sql.includes('UPDATE inventory.inventory_balances')) {
        return [{ id: 'balance-1' }];
      }

      if (sql.includes('FROM inventory.inventory_reservations r')) {
        return [reservationDetailRow()];
      }

      if (sql.includes('FROM inventory.inventory_reservations')) {
        return [
          {
            id: TEST_RESERVATION_ID,
            status: 'ACTIVE',
            reservedQuantity: 2,
            consumedQuantity: 0,
            allocatedQuantity: 0,
            partId: TEST_PART_ID,
            stockLocationId: TEST_LOCATION_ID,
            stockLotId: TEST_STOCK_LOT_ID,
            workOrderId: TEST_WORK_ORDER_ID,
            workOrderPartId: TEST_WORK_ORDER_PART_ID,
          },
        ];
      }

      throw new Error(`Unhandled query: ${sql}`);
    }),
    $executeRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push({ sql: sqlText(strings), values });
      return 1;
    }),
  };

  const prisma = {
    $transaction: mock.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return { prisma, queryCalls, executeCalls };
}

function createInventoryAdjustmentHarness() {
  const queryCalls: RawSqlCall[] = [];
  const executeCalls: RawSqlCall[] = [];

  const tx = {
    $queryRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      queryCalls.push({ sql, values });

      if (sql.includes('FROM inventory.stock_lots lot')) {
        return [
          {
            stockLotId: TEST_STOCK_LOT_ID,
            lotNumber: 'LOT-001',
            lotState: 'AVAILABLE',
            partId: TEST_PART_ID,
            partSku: 'GG-LIFT',
            partName: 'Lift kit',
            stockLocationId: TEST_LOCATION_ID,
            locationName: 'Main Warehouse',
            quantityOnHand: 5,
            quantityReserved: 2,
          },
        ];
      }

      if (sql.includes('UPDATE inventory.inventory_balances')) {
        return [{ id: 'balance-1' }];
      }

      throw new Error(`Unhandled query: ${sql}`);
    }),
    $executeRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push({ sql: sqlText(strings), values });
      return 1;
    }),
  };

  const prisma = {
    $transaction: mock.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return { prisma, queryCalls, executeCalls };
}

function createInventoryTransferHarness() {
  const queryCalls: RawSqlCall[] = [];
  const executeCalls: RawSqlCall[] = [];

  const tx = {
    $queryRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      queryCalls.push({ sql, values });

      if (sql.includes('FROM inventory.stock_lots lot')) {
        return [
          {
            stockLotId: TEST_STOCK_LOT_ID,
            lotNumber: 'LOT-001',
            serialNumber: null,
            lotState: 'AVAILABLE',
            partId: TEST_PART_ID,
            partSku: 'GG-LIFT',
            partName: 'Lift kit',
            unitOfMeasureId: '00000000-0000-4000-8000-000000000099',
            unitOfMeasure: 'EA',
            fromStockLocationId: TEST_LOCATION_ID,
            fromLocationName: 'Main Warehouse',
            quantityOnHand: 5,
            quantityReserved: 1,
          },
        ];
      }

      if (sql.includes('FROM inventory.stock_locations')) {
        return [
          {
            id: TEST_DESTINATION_LOCATION_ID,
            locationName: 'Bay 1',
          },
        ];
      }

      if (sql.includes('UPDATE inventory.inventory_balances')) {
        return [{ id: 'balance-1' }];
      }

      throw new Error(`Unhandled query: ${sql}`);
    }),
    $executeRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push({ sql: sqlText(strings), values });
      return 1;
    }),
  };

  const prisma = {
    $transaction: mock.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return { prisma, queryCalls, executeCalls };
}

function createCycleCountHarness() {
  const queryCalls: RawSqlCall[] = [];
  const executeCalls: RawSqlCall[] = [];

  const tx = {
    $queryRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      queryCalls.push({ sql, values });

      if (sql.includes('FROM inventory.stock_locations')) {
        return [
          {
            id: TEST_LOCATION_ID,
            locationName: 'Main Warehouse',
          },
        ];
      }

      if (sql.includes('FROM inventory.stock_lots lot')) {
        return [
          {
            stockLotId: TEST_STOCK_LOT_ID,
            lotNumber: 'LOT-001',
            lotState: 'AVAILABLE',
            partId: TEST_PART_ID,
            partSku: 'GG-LIFT',
            partName: 'Lift kit',
            unitOfMeasure: 'EA',
            stockLocationId: TEST_LOCATION_ID,
            locationName: 'Main Warehouse',
            quantityOnHand: 5,
            quantityReserved: 1,
          },
        ];
      }

      if (sql.includes('UPDATE inventory.inventory_balances')) {
        return [{ id: 'balance-1' }];
      }

      throw new Error(`Unhandled query: ${sql}`);
    }),
    $executeRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push({ sql: sqlText(strings), values });
      return 1;
    }),
  };

  const prisma = {
    $transaction: mock.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return { prisma, queryCalls, executeCalls };
}
