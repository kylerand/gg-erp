import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  disconnectTicketHandlerDependencies,
  getWoDetailHandler,
  setTicketHandlerPrismaForTests,
} from '../lambda/tickets/handlers.js';

const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000001';
const WORK_ORDER_PART_ID = '00000000-0000-4000-8000-000000000002';
const PART_ID = '00000000-0000-4000-8000-000000000003';
const STOCK_LOT_ID = '00000000-0000-4000-8000-000000000004';
const STOCK_LOCATION_ID = '00000000-0000-4000-8000-000000000005';

after(async () => {
  setTicketHandlerPrismaForTests(undefined);
  await disconnectTicketHandlerDependencies();
});

test('getWoDetailHandler returns material quantities and inline reservations', async () => {
  setTicketHandlerPrismaForTests({
    woOrder: {
      async findUnique() {
        return {
          id: WORK_ORDER_ID,
          workOrderNumber: 'WO-1001',
          title: 'Final assembly',
          customerReference: 'CUST-1',
          assetReference: 'Club Car DS',
          stockLocation: { locationName: 'Main Shop' },
          status: 'READY',
          dueAt: new Date('2026-05-07T12:00:00.000Z'),
          operations: [
            { id: 'op-1', operationName: 'Stage parts', operationStatus: 'DONE' },
            { id: 'op-2', operationName: 'Install kit', operationStatus: 'PENDING' },
          ],
          parts: [
            {
              id: WORK_ORDER_PART_ID,
              partId: PART_ID,
              partStatus: 'RESERVED',
              requestedQuantity: 5,
              reservedQuantity: 2,
              consumedQuantity: 1,
              part: { sku: 'KIT-001', name: 'Lift kit' },
            },
          ],
        };
      },
    },
    async $queryRaw() {
      return [
        {
          id: '00000000-0000-4000-8000-000000000006',
          status: 'ACTIVE',
          reservedQuantity: 2,
          consumedQuantity: 0,
          allocatedQuantity: 0,
          reservationPriority: 100,
          shortageReason: null,
          expiresAt: null,
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
          updatedAt: new Date('2026-05-05T12:00:00.000Z'),
          partId: PART_ID,
          partSku: 'KIT-001',
          partName: 'Lift kit',
          unitOfMeasure: 'EA',
          stockLocationId: STOCK_LOCATION_ID,
          locationName: 'Main Shop',
          stockLotId: STOCK_LOT_ID,
          lotNumber: 'LOT-1',
          serialNumber: null,
          workOrderId: WORK_ORDER_ID,
          workOrderNumber: 'WO-1001',
          workOrderTitle: 'Final assembly',
          workOrderPartId: WORK_ORDER_PART_ID,
        },
      ];
    },
  } as unknown as Partial<PrismaClient>);

  const response = await getWoDetailHandler({
    pathParameters: { id: WORK_ORDER_ID },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    workOrder: {
      materialReadiness: string;
      parts: Array<{
        partId: string;
        partSku: string;
        requestedQuantity: number;
        reservedQuantity: number;
        consumedQuantity: number;
        openQuantity: number;
        state: string;
        reservations: Array<{ id: string; openQuantity: number; lotNumber: string }>;
      }>;
      reservations: Array<{ workOrderPartId: string; lotNumber: string }>;
    };
  };

  assert.equal(payload.workOrder.materialReadiness, 'PARTIAL');
  assert.equal(payload.workOrder.parts.length, 1);
  assert.equal(payload.workOrder.parts[0].partId, PART_ID);
  assert.equal(payload.workOrder.parts[0].partSku, 'KIT-001');
  assert.equal(payload.workOrder.parts[0].requestedQuantity, 5);
  assert.equal(payload.workOrder.parts[0].reservedQuantity, 2);
  assert.equal(payload.workOrder.parts[0].consumedQuantity, 1);
  assert.equal(payload.workOrder.parts[0].openQuantity, 2);
  assert.equal(payload.workOrder.parts[0].state, 'RESERVED');
  assert.equal(payload.workOrder.parts[0].reservations[0].lotNumber, 'LOT-1');
  assert.equal(payload.workOrder.parts[0].reservations[0].openQuantity, 2);
  assert.equal(payload.workOrder.reservations[0].workOrderPartId, WORK_ORDER_PART_ID);
});
