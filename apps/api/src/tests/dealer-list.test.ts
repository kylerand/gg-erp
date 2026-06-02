import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  createDealerAccountHandler,
  disconnectListDealersHandlerDependencies,
  handler as listDealersHandler,
  setListDealersPrismaForTests,
  updateDealerAccountHandler,
} from '../lambda/identity/list-dealers.handler.js';

test('listDealersHandler returns registry-backed dealer accounts', async () => {
  let findManyArgs: unknown;
  let countArgs: unknown;
  const updatedAt = new Date('2026-05-31T12:00:00Z');

  setListDealersPrismaForTests({
    dealerAccount: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [
          {
            id: 'dealer-1',
            dealerCode: 'DEALER-RIVER',
            territory: 'Central Florida',
            serviceRelationship: 'ACTIVE',
            accountOwner: 'Jordan Manager',
            notes: 'Preferred partner',
            updatedAt,
            customer: {
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
      id: 'dealer-1',
      customerId: 'customer-1',
      dealerCode: 'DEALER-RIVER',
      name: 'Riverside Golf Club',
      primaryContact: 'Jordan Manager',
      contactEmail: 'ops@riverside.example',
      territory: 'Central Florida',
      serviceRelationship: 'ACTIVE',
      customerState: 'ACTIVE',
      phone: '555-0100',
      accountOwner: 'Jordan Manager',
      notes: 'Preferred partner',
      source: 'dealer-account',
      updatedAt: updatedAt.toISOString(),
    });
    assert.ok(JSON.stringify(findManyArgs).includes('dealerCode'));
    assert.ok(JSON.stringify(findManyArgs).includes('customer'));
    assert.ok(JSON.stringify(countArgs).includes('riverside'));
  } finally {
    await disconnectListDealersHandlerDependencies();
  }
});

test('createDealerAccountHandler creates a dealer account from an active customer', async () => {
  let createArgs: unknown;
  const updatedAt = new Date('2026-06-02T12:00:00Z');

  setListDealersPrismaForTests({
    customer: {
      findUnique: async () => ({
        id: 'customer-1',
        fullName: 'Riley Dealer',
        companyName: 'Riley Golf Supply',
        email: 'riley@example.com',
        phone: '555-0123',
        billingAddress: '10 Range Rd, Tampa, FL',
        shippingAddress: null,
        state: 'ACTIVE',
        archivedAt: null,
        updatedAt,
      }),
    },
    dealerAccount: {
      create: async (args: unknown) => {
        createArgs = args;
        return {
          id: 'dealer-1',
          customerId: 'customer-1',
          dealerCode: 'DEALER-RILEY',
          territory: 'West Florida',
          serviceRelationship: 'ACTIVE',
          accountOwner: 'Casey Manager',
          notes: 'New dealer partner',
          updatedAt,
          customer: {
            id: 'customer-1',
            fullName: 'Riley Dealer',
            companyName: 'Riley Golf Supply',
            email: 'riley@example.com',
            phone: '555-0123',
            billingAddress: '10 Range Rd, Tampa, FL',
            shippingAddress: null,
            state: 'ACTIVE',
            updatedAt,
          },
        };
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await createDealerAccountHandler({
      body: JSON.stringify({
        customerId: 'customer-1',
        dealerCode: ' DEALER-RILEY ',
        territory: ' West Florida ',
        serviceRelationship: 'ACTIVE',
        accountOwner: ' Casey Manager ',
        notes: ' New dealer partner ',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      dealer: {
        id: string;
        customerId: string;
        dealerCode: string;
        name: string;
        territory: string;
        serviceRelationship: string;
        accountOwner: string;
        notes: string;
      };
    };

    assert.deepEqual(payload.dealer, {
      id: 'dealer-1',
      customerId: 'customer-1',
      dealerCode: 'DEALER-RILEY',
      name: 'Riley Golf Supply',
      primaryContact: 'Riley Dealer',
      contactEmail: 'riley@example.com',
      phone: '555-0123',
      territory: 'West Florida',
      serviceRelationship: 'ACTIVE',
      customerState: 'ACTIVE',
      accountOwner: 'Casey Manager',
      notes: 'New dealer partner',
      source: 'dealer-account',
      updatedAt: updatedAt.toISOString(),
    });
    assert.ok(JSON.stringify(createArgs).includes('customerId'));
    assert.ok(JSON.stringify(createArgs).includes('DEALER-RILEY'));
    assert.ok(JSON.stringify(createArgs).includes('include'));
  } finally {
    await disconnectListDealersHandlerDependencies();
  }
});

test('updateDealerAccountHandler patches account fields', async () => {
  let updateArgs: unknown;
  const updatedAt = new Date('2026-06-02T12:30:00Z');

  setListDealersPrismaForTests({
    dealerAccount: {
      findFirst: async () => ({
        id: 'dealer-1',
        customerId: 'customer-1',
        dealerCode: 'DEALER-OLD',
        territory: 'Old Territory',
        serviceRelationship: 'ACTIVE',
        accountOwner: 'Old Owner',
        notes: 'Old note',
        updatedAt,
        customer: {
          id: 'customer-1',
          fullName: 'Riley Dealer',
          companyName: 'Riley Golf Supply',
          email: 'riley@example.com',
          phone: '555-0123',
          billingAddress: '10 Range Rd, Tampa, FL',
          shippingAddress: null,
          state: 'ACTIVE',
          updatedAt,
        },
      }),
      update: async (args: unknown) => {
        updateArgs = args;
        return {
          id: 'dealer-1',
          customerId: 'customer-1',
          dealerCode: 'DEALER-RILEY',
          territory: 'West Florida',
          serviceRelationship: 'INACTIVE',
          accountOwner: 'Casey Manager',
          notes: 'Warranty handoff owner changed',
          updatedAt,
          customer: {
            id: 'customer-1',
            fullName: 'Riley Dealer',
            companyName: 'Riley Golf Supply',
            email: 'riley@example.com',
            phone: '555-0123',
            billingAddress: '10 Range Rd, Tampa, FL',
            shippingAddress: null,
            state: 'ACTIVE',
            updatedAt,
          },
        };
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await updateDealerAccountHandler({
      pathParameters: { id: 'dealer-1' },
      body: JSON.stringify({
        dealerCode: ' DEALER-RILEY ',
        territory: ' West Florida ',
        serviceRelationship: 'INACTIVE',
        accountOwner: ' Casey Manager ',
        notes: ' Warranty handoff owner changed ',
      }),
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      dealer: { dealerCode: string; territory: string; serviceRelationship: string };
    };
    assert.equal(payload.dealer.dealerCode, 'DEALER-RILEY');
    assert.equal(payload.dealer.territory, 'West Florida');
    assert.equal(payload.dealer.serviceRelationship, 'INACTIVE');
    assert.ok(JSON.stringify(updateArgs).includes('DEALER-RILEY'));
    assert.ok(JSON.stringify(updateArgs).includes('INACTIVE'));
  } finally {
    await disconnectListDealersHandlerDependencies();
  }
});
