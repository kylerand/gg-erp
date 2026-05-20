import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  convertQuoteToWorkOrderHandler,
  disconnectSalesHandlerDependencies,
  setSalesHandlerPrismaForTests,
} from '../lambda/sales/handlers.js';

const QUOTE_ID = '00000000-0000-4000-8000-000000000101';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000102';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000103';
const PART_ID = '00000000-0000-4000-8000-000000000104';
const ACTOR_ID = '00000000-0000-4000-8000-000000000105';

after(async () => {
  setSalesHandlerPrismaForTests(undefined);
  await disconnectSalesHandlerDependencies();
});

test('convertQuoteToWorkOrderHandler requires an authenticated actor', async () => {
  const response = await convertQuoteToWorkOrderHandler({
    pathParameters: { id: QUOTE_ID },
    body: '{}',
  });

  assert.equal(response.statusCode, 401);
});

test('convertQuoteToWorkOrderHandler rejects quotes that are not accepted', async () => {
  setSalesHandlerPrismaForTests({
    quote: {
      async findUnique() {
        return {
          id: QUOTE_ID,
          quoteNumber: 'Q-20260520-0001',
          customerId: CUSTOMER_ID,
          opportunityId: null,
          status: 'SENT',
          subtotal: 100,
          taxRate: 0,
          taxAmount: 0,
          total: 100,
          validUntil: null,
          notes: null,
          termsAndConditions: null,
          createdByUserId: ACTOR_ID,
          approvedByUserId: null,
          convertedWoId: null,
          createdAt: new Date('2026-05-20T12:00:00.000Z'),
          updatedAt: new Date('2026-05-20T12:00:00.000Z'),
          version: 0,
          lines: [],
        };
      },
    },
  } as unknown as Partial<PrismaClient>);

  const response = await convertQuoteToWorkOrderHandler({
    pathParameters: { id: QUOTE_ID },
    headers: { 'x-actor-id': ACTOR_ID },
    body: '{}',
  });

  assert.equal(response.statusCode, 409);
  const payload = JSON.parse(response.body) as { requiredStatus: string; currentStatus: string };
  assert.equal(payload.requiredStatus, 'ACCEPTED');
  assert.equal(payload.currentStatus, 'SENT');
});

test('convertQuoteToWorkOrderHandler converts an accepted quote into executable work', async () => {
  let createdWorkOrder: Record<string, unknown> | undefined;
  let createdOperations: Array<Record<string, unknown>> = [];
  let createdPartLines: Array<Record<string, unknown>> = [];
  let quoteUpdate: Record<string, unknown> | undefined;
  let opportunityUpdate: Record<string, unknown> | undefined;
  let salesActivity: Record<string, unknown> | undefined;
  let statusHistory: Record<string, unknown> | undefined;

  const acceptedQuote = {
    id: QUOTE_ID,
    quoteNumber: 'Q-20260520-0001',
    customerId: CUSTOMER_ID,
    opportunityId: OPPORTUNITY_ID,
    status: 'ACCEPTED',
    subtotal: 625,
    taxRate: 0,
    taxAmount: 0,
    total: 625,
    validUntil: new Date('2026-06-20T00:00:00.000Z'),
    notes: 'Customer approved lift kit and alignment.',
    termsAndConditions: null,
    createdByUserId: ACTOR_ID,
    approvedByUserId: ACTOR_ID,
    convertedWoId: null,
    createdAt: new Date('2026-05-20T12:00:00.000Z'),
    updatedAt: new Date('2026-05-20T12:05:00.000Z'),
    version: 2,
    lines: [
      {
        id: 'line-1',
        quoteId: QUOTE_ID,
        partId: PART_ID,
        description: 'Install lift kit',
        quantity: 1,
        unitPrice: 500,
        discountPercent: 0,
        lineTotal: 500,
        sortOrder: 0,
      },
      {
        id: 'line-2',
        quoteId: QUOTE_ID,
        partId: null,
        description: 'Final alignment and test drive',
        quantity: 1,
        unitPrice: 125,
        discountPercent: 0,
        lineTotal: 125,
        sortOrder: 1,
      },
    ],
  };

  setSalesHandlerPrismaForTests({
    quote: {
      async findUnique() {
        return acceptedQuote;
      },
    },
    part: {
      async findMany() {
        return [{ id: PART_ID }];
      },
    },
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      return callback({
        woOrder: {
          async create({ data }: { data: Record<string, unknown> }) {
            createdWorkOrder = data;
            return {
              id: data.id,
              workOrderNumber: data.workOrderNumber,
              title: data.title,
              status: data.status,
            };
          },
        },
        woOperation: {
          async createMany({ data }: { data: Array<Record<string, unknown>> }) {
            createdOperations = data;
            return { count: data.length };
          },
        },
        woPartLine: {
          async createMany({ data }: { data: Array<Record<string, unknown>> }) {
            createdPartLines = data;
            return { count: data.length };
          },
        },
        woStatusHistory: {
          async create({ data }: { data: Record<string, unknown> }) {
            statusHistory = data;
            return data;
          },
        },
        salesOpportunity: {
          async update({ data }: { data: Record<string, unknown> }) {
            opportunityUpdate = data;
            return data;
          },
        },
        salesActivity: {
          async create({ data }: { data: Record<string, unknown> }) {
            salesActivity = data;
            return data;
          },
        },
        quote: {
          async update({ data }: { data: Record<string, unknown> }) {
            quoteUpdate = data;
            return {
              ...acceptedQuote,
              ...data,
              convertedWoId: createdWorkOrder?.id,
              status: 'CONVERTED',
            };
          },
        },
      });
    },
  } as unknown as Partial<PrismaClient>);

  const response = await convertQuoteToWorkOrderHandler({
    pathParameters: { id: QUOTE_ID },
    headers: { 'x-actor-id': ACTOR_ID, 'x-correlation-id': 'quote-convert-test' },
    body: '{}',
  });

  assert.equal(response.statusCode, 201);
  assert.equal(createdWorkOrder?.customerReference, CUSTOMER_ID);
  assert.equal(createdWorkOrder?.status, 'READY');
  assert.equal(createdWorkOrder?.createdByUserId, ACTOR_ID);
  assert.equal(createdOperations.length, 2);
  assert.equal(createdOperations[0].operationName, 'Install lift kit');
  assert.equal(createdOperations[0].operationStatus, 'READY');
  assert.equal(createdPartLines.length, 1);
  assert.equal(createdPartLines[0].partId, PART_ID);
  assert.equal(createdPartLines[0].requestedQuantity, 1);
  assert.equal(quoteUpdate?.status, 'CONVERTED');
  assert.equal(quoteUpdate?.convertedWoId, createdWorkOrder?.id);
  assert.equal(opportunityUpdate?.stage, 'CLOSED_WON');
  assert.equal(opportunityUpdate?.wonWorkOrderId, createdWorkOrder?.id);
  assert.equal(salesActivity?.activityType, 'NOTE');
  assert.equal(statusHistory?.reasonCode, 'QUOTE_CONVERTED');

  const payload = JSON.parse(response.body) as {
    quote: { status: string; convertedWoId: string };
    workOrder: { id: string; workOrderNumber: string; status: string };
    operationsCreated: number;
    partLinesCreated: number;
  };
  assert.equal(payload.quote.status, 'CONVERTED');
  assert.equal(payload.workOrder.status, 'READY');
  assert.equal(payload.operationsCreated, 2);
  assert.equal(payload.partLinesCreated, 1);
});

