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
          statusHistory: [],
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
    customer: {
      async findFirst() {
        return null;
      },
    },
    cartVehicle: {
      async findFirst() {
        return null;
      },
    },
    quote: {
      async findMany() {
        return [];
      },
    },
    salesOpportunity: {
      async findMany() {
        return [];
      },
    },
    salesActivity: {
      async findMany() {
        return [];
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

test('getWoDetailHandler returns resolved customer, cart, sales, and status context', async () => {
  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000010';
  const CART_ID = '00000000-0000-4000-8000-000000000011';

  setTicketHandlerPrismaForTests({
    woOrder: {
      async findUnique() {
        return {
          id: WORK_ORDER_ID,
          workOrderNumber: 'WO-1002',
          title: 'Commercial context build',
          customerReference: CUSTOMER_ID,
          assetReference: CART_ID,
          stockLocation: { locationName: 'Bay 1' },
          status: 'IN_PROGRESS',
          dueAt: new Date('2026-05-08T12:00:00.000Z'),
          statusHistory: [
            {
              id: 'hist-1',
              fromStatus: 'READY',
              toStatus: 'IN_PROGRESS',
              reasonCode: 'SHOP_START',
              reasonNote: 'Started in bay',
              actorUserId: '00000000-0000-4000-8000-000000000012',
              correlationId: 'corr-1',
              createdAt: new Date('2026-05-07T12:00:00.000Z'),
            },
          ],
          operations: [],
          parts: [],
        };
      },
    },
    customer: {
      async findFirst() {
        return {
          id: CUSTOMER_ID,
          fullName: 'Riverside Golf Club',
          companyName: 'Riverside Golf Club LLC',
          email: 'ops@riverside.example',
          phone: '555-0100',
          state: 'ACTIVE',
          preferredContactMethod: 'EMAIL',
          externalReference: 'CUST-100',
        };
      },
    },
    cartVehicle: {
      async findFirst() {
        return {
          id: CART_ID,
          vin: '1F9GG000000000001',
          serialNumber: 'GG-001',
          modelCode: 'CC-DS',
          modelYear: 2019,
          customerId: CUSTOMER_ID,
          state: 'IN_BUILD',
        };
      },
    },
    quote: {
      async findMany() {
        return [
          {
            id: 'quote-1',
            quoteNumber: 'Q-00001',
            status: 'ACCEPTED',
            total: 12500,
            validUntil: new Date('2026-06-01T00:00:00.000Z'),
            convertedWoId: WORK_ORDER_ID,
            updatedAt: new Date('2026-05-06T12:00:00.000Z'),
          },
        ];
      },
    },
    salesOpportunity: {
      async findMany() {
        return [
          {
            id: 'opp-1',
            title: 'Fleet refresh',
            stage: 'CLOSED_WON',
            probability: 100,
            estimatedValue: 12500,
            expectedCloseDate: new Date('2026-05-01T00:00:00.000Z'),
            wonWorkOrderId: WORK_ORDER_ID,
            updatedAt: new Date('2026-05-06T12:00:00.000Z'),
          },
        ];
      },
    },
    salesActivity: {
      async findMany() {
        return [
          {
            id: 'activity-1',
            activityType: 'NOTE',
            subject: 'Customer approved scope',
            body: 'Confirmed build details.',
            dueDate: null,
            completedAt: null,
            createdAt: new Date('2026-05-05T12:00:00.000Z'),
          },
        ];
      },
    },
    async $queryRaw() {
      return [];
    },
  } as unknown as Partial<PrismaClient>);

  const response = await getWoDetailHandler({
    pathParameters: { id: WORK_ORDER_ID },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    workOrder: {
      customerProfile?: { id: string; fullName: string; externalReference?: string };
      cartProfile?: { id: string; serialNumber: string; state: string };
      commercialContext: {
        quotes: Array<{ id: string; quoteNumber: string; total: number }>;
        opportunities: Array<{ id: string; title: string; stage: string }>;
        activities: Array<{ id: string; subject: string }>;
      };
      statusHistory: Array<{ toStatus: string; reasonCode?: string }>;
    };
  };

  assert.equal(payload.workOrder.customerProfile?.id, CUSTOMER_ID);
  assert.equal(payload.workOrder.customerProfile?.fullName, 'Riverside Golf Club');
  assert.equal(payload.workOrder.customerProfile?.externalReference, 'CUST-100');
  assert.equal(payload.workOrder.cartProfile?.id, CART_ID);
  assert.equal(payload.workOrder.cartProfile?.serialNumber, 'GG-001');
  assert.equal(payload.workOrder.commercialContext.quotes[0].quoteNumber, 'Q-00001');
  assert.equal(payload.workOrder.commercialContext.quotes[0].total, 12500);
  assert.equal(payload.workOrder.commercialContext.opportunities[0].stage, 'CLOSED_WON');
  assert.equal(
    payload.workOrder.commercialContext.activities[0].subject,
    'Customer approved scope',
  );
  assert.equal(payload.workOrder.statusHistory[0].toStatus, 'IN_PROGRESS');
  assert.equal(payload.workOrder.statusHistory[0].reasonCode, 'SHOP_START');
});
