import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  disconnectListDealersHandlerDependencies,
  handler as listDealersHandler,
  setListDealersPrismaForTests,
} from '../lambda/identity/list-dealers.handler.js';

test('listDealersHandler returns customer-backed dealer accounts', async () => {
  let findManyArgs: unknown;
  let countArgs: unknown;
  const updatedAt = new Date('2026-05-31T12:00:00Z');

  setListDealersPrismaForTests({
    customer: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [
          {
            id: 'customer-1',
            fullName: 'Jordan Manager',
            companyName: 'Riverside Golf Club',
            email: 'ops@riverside.example',
            phone: '555-0100',
            billingAddress: '100 Fairway Dr, Orlando, FL',
            shippingAddress: null,
            state: 'ACTIVE',
            updatedAt,
          },
        ];
      },
      count: async (args: unknown) => {
        countArgs = args;
        return 1;
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await listDealersHandler({
      queryStringParameters: {
        search: 'riverside',
        limit: '25',
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        customerId: string;
        name: string;
        primaryContact: string;
        contactEmail: string;
        territory: string;
        serviceRelationship: string;
        customerState: string;
      }>;
      total: number;
      limit: number;
      offset: number;
    };

    assert.equal(payload.total, 1);
    assert.equal(payload.limit, 25);
    assert.equal(payload.offset, 0);
    assert.deepEqual(payload.items[0], {
      id: 'customer-1',
      customerId: 'customer-1',
      name: 'Riverside Golf Club',
      primaryContact: 'Jordan Manager',
      contactEmail: 'ops@riverside.example',
      territory: 'Orlando, FL',
      serviceRelationship: 'ACTIVE',
      customerState: 'ACTIVE',
      phone: '555-0100',
      source: 'customer-company',
      updatedAt: updatedAt.toISOString(),
    });
    assert.ok(JSON.stringify(findManyArgs).includes('companyName'));
    assert.ok(JSON.stringify(countArgs).includes('riverside'));
  } finally {
    await disconnectListDealersHandlerDependencies();
  }
});
