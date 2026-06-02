import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  disconnectListDealerRelationshipsHandlerDependencies,
  handler as listDealerRelationshipsHandler,
  setListDealerRelationshipsPrismaForTests,
  updateDealerRelationshipHandler,
} from '../lambda/identity/list-dealer-relationships.handler.js';

test('listDealerRelationshipsHandler returns dealer relationship rows with customer and cart context', async () => {
  let findManyArgs: unknown;
  let countArgs: unknown;
  const now = new Date('2026-06-01T12:00:00Z');

  setListDealerRelationshipsPrismaForTests({
    dealerRelationship: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [
          {
            id: 'relationship-1',
            relationshipType: 'ACCOUNT_OWNER',
            relationshipState: 'ACTIVE',
            escalationOwner: 'Jordan Manager',
            notes: 'Dealer-owned fleet cart',
            startedAt: now,
            endedAt: null,
            updatedAt: now,
            dealerAccount: {
              id: 'dealer-1',
              dealerCode: 'DEALER-RIVER',
              territory: 'Central Florida',
              serviceRelationship: 'ACTIVE',
              customer: {
                id: 'dealer-customer-1',
                fullName: 'Jordan Manager',
                companyName: 'Riverside Golf Club',
                email: 'ops@riverside.example',
                phone: '555-0100',
                state: 'ACTIVE',
              },
            },
            customer: {
              id: 'customer-1',
              fullName: 'Avery Customer',
              companyName: null,
              email: 'avery@example.com',
              phone: '555-0199',
              state: 'ACTIVE',
            },
            cartVehicle: {
              id: 'vehicle-1',
              vin: '7GGERPTEST0000001',
              serialNumber: 'GG-100',
              modelCode: 'LUX-4',
              modelYear: 2026,
              state: 'REGISTERED',
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
    const response = await listDealerRelationshipsHandler({
      queryStringParameters: {
        search: 'riverside',
        state: 'ACTIVE',
        limit: '10',
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{
        id: string;
        dealerId: string;
        dealerCode: string;
        dealerName: string;
        serviceRelationship: string;
        territory: string;
        customerId: string;
        customerName: string;
        customerEmail: string;
        customerPhone: string;
        cartVehicleId: string;
        cartDisplayName: string;
        relationshipType: string;
        relationshipState: string;
        source: string;
      }>;
      total: number;
      limit: number;
      offset: number;
    };

    assert.equal(payload.total, 1);
    assert.equal(payload.limit, 10);
    assert.equal(payload.offset, 0);
    assert.deepEqual(payload.items[0], {
      id: 'relationship-1',
      dealerId: 'dealer-1',
      dealerCustomerId: 'dealer-customer-1',
      dealerCode: 'DEALER-RIVER',
      dealerName: 'Riverside Golf Club',
      serviceRelationship: 'ACTIVE',
      territory: 'Central Florida',
      customerId: 'customer-1',
      customerName: 'Avery Customer',
      customerEmail: 'avery@example.com',
      customerPhone: '555-0199',
      customerState: 'ACTIVE',
      cartVehicleId: 'vehicle-1',
      cartDisplayName: '2026 LUX-4',
      vin: '7GGERPTEST0000001',
      serialNumber: 'GG-100',
      cartState: 'REGISTERED',
      relationshipType: 'ACCOUNT_OWNER',
      relationshipState: 'ACTIVE',
      escalationOwner: 'Jordan Manager',
      notes: 'Dealer-owned fleet cart',
      source: 'dealer-relationship',
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    assert.ok(JSON.stringify(findManyArgs).includes('dealerAccount'));
    assert.ok(JSON.stringify(findManyArgs).includes('cartVehicle'));
    assert.ok(JSON.stringify(countArgs).includes('ACTIVE'));
  } finally {
    await disconnectListDealerRelationshipsHandlerDependencies();
  }
});

test('updateDealerRelationshipHandler patches relationship state, owner, and notes', async () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const relationship = {
    id: 'relationship-1',
    relationshipType: 'SERVICING_DEALER',
    relationshipState: 'ACTIVE',
    escalationOwner: null,
    notes: null,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    dealerAccount: {
      id: 'dealer-1',
      dealerCode: 'DEALER-RIVER',
      territory: 'Central Florida',
      serviceRelationship: 'ACTIVE',
      customer: {
        id: 'dealer-customer-1',
        fullName: 'Jordan Manager',
        companyName: 'Riverside Golf Club',
        email: 'ops@riverside.example',
        phone: '555-0100',
        state: 'ACTIVE',
      },
    },
    customer: {
      id: 'customer-1',
      fullName: 'Avery Customer',
      companyName: null,
      email: 'avery@example.com',
      phone: '555-0199',
      state: 'ACTIVE',
    },
    cartVehicle: null,
  };
  let updateArgs: unknown;

  setListDealerRelationshipsPrismaForTests({
    dealerRelationship: {
      findUnique: async () => relationship,
      update: async (args: { data: Record<string, unknown> }) => {
        updateArgs = args;
        return {
          ...relationship,
          relationshipState: args.data.relationshipState,
          escalationOwner: args.data.escalationOwner,
          notes: args.data.notes,
          endedAt: args.data.endedAt,
          updatedAt: args.data.updatedAt,
        };
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await updateDealerRelationshipHandler({
      pathParameters: { id: 'relationship-1' },
      body: JSON.stringify({
        relationshipState: 'ended',
        escalationOwner: '  Jordan Manager  ',
        notes: '  Warranty handoff complete  ',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      (updateArgs as { data: Record<string, unknown> }).data,
      {
        relationshipState: 'ENDED',
        endedAt: (updateArgs as { data: { endedAt: Date } }).data.endedAt,
        escalationOwner: 'Jordan Manager',
        notes: 'Warranty handoff complete',
        updatedAt: (updateArgs as { data: { updatedAt: Date } }).data.updatedAt,
        version: { increment: 1 },
      },
    );

    const payload = JSON.parse(response.body) as {
      relationship: {
        id: string;
        relationshipState: string;
        escalationOwner: string;
        notes: string;
        endedAt: string;
      };
    };
    assert.equal(payload.relationship.id, 'relationship-1');
    assert.equal(payload.relationship.relationshipState, 'ENDED');
    assert.equal(payload.relationship.escalationOwner, 'Jordan Manager');
    assert.equal(payload.relationship.notes, 'Warranty handoff complete');
    assert.ok(payload.relationship.endedAt);
  } finally {
    await disconnectListDealerRelationshipsHandlerDependencies();
  }
});

test('updateDealerRelationshipHandler validates relationship state before writing', async () => {
  const now = new Date('2026-06-01T12:00:00Z');

  setListDealerRelationshipsPrismaForTests({
    dealerRelationship: {
      findUnique: async () => ({
        id: 'relationship-1',
        relationshipType: 'SERVICING_DEALER',
        relationshipState: 'ACTIVE',
        escalationOwner: null,
        notes: null,
        startedAt: now,
        endedAt: null,
        updatedAt: now,
        dealerAccount: {
          id: 'dealer-1',
          dealerCode: null,
          territory: null,
          serviceRelationship: 'ACTIVE',
          customer: {
            id: 'dealer-customer-1',
            fullName: 'Dealer',
            companyName: null,
            email: 'dealer@example.com',
            phone: null,
            state: 'ACTIVE',
          },
        },
        customer: {
          id: 'customer-1',
          fullName: 'Customer',
          companyName: null,
          email: 'customer@example.com',
          phone: null,
          state: 'ACTIVE',
        },
        cartVehicle: null,
      }),
      update: async () => {
        throw new Error('update should not be called');
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await updateDealerRelationshipHandler({
      pathParameters: { id: 'relationship-1' },
      body: JSON.stringify({ relationshipState: 'paused' }),
    });

    assert.equal(response.statusCode, 422);
  } finally {
    await disconnectListDealerRelationshipsHandlerDependencies();
  }
});
