import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  createWarrantyClaimHandler,
  disconnectWarrantyClaimsHandlerDependencies,
  handler as listWarrantyClaimsHandler,
  setWarrantyClaimsPrismaForTests,
  updateWarrantyClaimHandler,
} from '../lambda/identity/list-warranty-claims.handler.js';

function customerRecord() {
  return {
    id: 'customer-1',
    fullName: 'Avery Customer',
    companyName: null,
    email: 'avery@example.com',
    phone: '555-0199',
    state: 'ACTIVE',
  };
}

function dealerAccountRecord() {
  return {
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
  };
}

function relationshipRecord() {
  return {
    id: 'relationship-1',
    dealerAccountId: 'dealer-1',
    customerId: 'customer-1',
    cartVehicleId: 'vehicle-1',
    relationshipType: 'WARRANTY_PROVIDER',
    relationshipState: 'ACTIVE',
    escalationOwner: 'Jordan Manager',
    dealerAccount: dealerAccountRecord(),
    cartVehicle: vehicleRecord(),
  };
}

function vehicleRecord() {
  return {
    id: 'vehicle-1',
    customerId: 'customer-1',
    vin: '7GGERPTEST0000001',
    serialNumber: 'GG-100',
    modelCode: 'LUX-4',
    modelYear: 2026,
    state: 'REGISTERED',
  };
}

function workOrderRecord() {
  return {
    id: 'work-order-1',
    workOrderNumber: 'WO-1001',
    customerReference: 'customer-1',
    assetReference: 'vehicle-1',
    title: 'Warranty brake service',
    status: 'IN_PROGRESS',
    dueAt: new Date('2026-06-05T12:00:00Z'),
  };
}

function claimRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-02T12:00:00Z');
  return {
    id: 'claim-1',
    claimNumber: 'WCLM-20260602-ABC12345',
    customerId: 'customer-1',
    dealerAccountId: 'dealer-1',
    dealerRelationshipId: 'relationship-1',
    cartVehicleId: 'vehicle-1',
    workOrderId: 'work-order-1',
    claimStatus: 'SUBMITTED',
    requestedAmountCents: 125000,
    approvedAmountCents: null,
    reimbursedAmountCents: null,
    externalReference: 'SM-WARR-101',
    claimReason: 'Warranty service',
    ownerUserId: null,
    notes: 'Provider packet sent',
    submittedAt: now,
    approvedAt: null,
    reimbursedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 0,
    customer: customerRecord(),
    dealerAccount: dealerAccountRecord(),
    dealerRelationship: relationshipRecord(),
    cartVehicle: vehicleRecord(),
    workOrder: workOrderRecord(),
    ...overrides,
  };
}

test('listWarrantyClaimsHandler returns live warranty claim context', async () => {
  let findManyArgs: unknown;
  let countArgs: unknown;

  setWarrantyClaimsPrismaForTests({
    warrantyClaim: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [claimRecord()];
      },
      count: async (args: unknown) => {
        countArgs = args;
        return 1;
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await listWarrantyClaimsHandler({
      queryStringParameters: {
        search: 'river',
        customerId: 'customer-1',
        status: 'SUBMITTED',
        limit: '25',
      },
    });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      items: Array<{
        claimNumber: string;
        dealerName: string;
        workOrderNumber: string;
        source: string;
      }>;
      total: number;
      limit: number;
    };
    assert.equal(payload.total, 1);
    assert.equal(payload.limit, 25);
    assert.deepEqual(payload.items[0], {
      id: 'claim-1',
      claimNumber: 'WCLM-20260602-ABC12345',
      customerId: 'customer-1',
      customerName: 'Avery Customer',
      customerEmail: 'avery@example.com',
      customerPhone: '555-0199',
      dealerId: 'dealer-1',
      dealerCode: 'DEALER-RIVER',
      dealerName: 'Riverside Golf Club',
      dealerRelationshipId: 'relationship-1',
      relationshipType: 'WARRANTY_PROVIDER',
      relationshipState: 'ACTIVE',
      escalationOwner: 'Jordan Manager',
      cartVehicleId: 'vehicle-1',
      cartDisplayName: '2026 LUX-4',
      vin: '7GGERPTEST0000001',
      serialNumber: 'GG-100',
      cartState: 'REGISTERED',
      workOrderId: 'work-order-1',
      workOrderNumber: 'WO-1001',
      workOrderTitle: 'Warranty brake service',
      workOrderStatus: 'IN_PROGRESS',
      claimStatus: 'SUBMITTED',
      requestedAmountCents: 125000,
      externalReference: 'SM-WARR-101',
      claimReason: 'Warranty service',
      notes: 'Provider packet sent',
      source: 'warranty-claim',
      submittedAt: new Date('2026-06-02T12:00:00Z').toISOString(),
      createdAt: new Date('2026-06-02T12:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-02T12:00:00Z').toISOString(),
      version: 0,
    });
    assert.ok(JSON.stringify(findManyArgs).includes('customer-1'));
    assert.ok(JSON.stringify(findManyArgs).includes('SUBMITTED'));
    assert.ok(JSON.stringify(findManyArgs).includes('dealerRelationship'));
    assert.ok(JSON.stringify(countArgs).includes('river'));
  } finally {
    await disconnectWarrantyClaimsHandlerDependencies();
  }
});

test('createWarrantyClaimHandler creates a provider-backed claim', async () => {
  let createArgs: unknown;

  setWarrantyClaimsPrismaForTests({
    customer: { findUnique: async () => customerRecord() },
    cartVehicle: { findUnique: async () => vehicleRecord() },
    woOrder: { findUnique: async () => workOrderRecord() },
    dealerRelationship: { findUnique: async () => relationshipRecord() },
    warrantyClaim: {
      create: async (args: { data: Record<string, unknown> }) => {
        createArgs = args;
        return claimRecord({
          claimNumber: args.data.claimNumber,
          claimStatus: args.data.claimStatus,
          requestedAmountCents: args.data.requestedAmountCents,
          submittedAt: args.data.submittedAt,
          createdAt: args.data.updatedAt,
          updatedAt: args.data.updatedAt,
        });
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await createWarrantyClaimHandler({
      body: JSON.stringify({
        customerId: 'customer-1',
        dealerRelationshipId: 'relationship-1',
        cartVehicleId: 'vehicle-1',
        workOrderId: 'work-order-1',
        requestedAmountCents: 125000,
        externalReference: ' SM-WARR-101 ',
        notes: ' Provider packet sent ',
      }),
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body) as {
      claim: { claimNumber: string; claimStatus: string };
    };
    assert.match(payload.claim.claimNumber, /^WCLM-\d{8}-[A-F0-9]{8}$/);
    assert.equal(payload.claim.claimStatus, 'SUBMITTED');
    const data = (createArgs as { data: Record<string, unknown> }).data;
    assert.equal(data.customerId, 'customer-1');
    assert.equal(data.dealerAccountId, 'dealer-1');
    assert.equal(data.dealerRelationshipId, 'relationship-1');
    assert.equal(data.requestedAmountCents, 125000);
    assert.equal(data.externalReference, 'SM-WARR-101');
    assert.equal(data.notes, 'Provider packet sent');
  } finally {
    await disconnectWarrantyClaimsHandlerDependencies();
  }
});

test('updateWarrantyClaimHandler records reimbursement status and amounts', async () => {
  let updateArgs: unknown;

  setWarrantyClaimsPrismaForTests({
    warrantyClaim: {
      findUnique: async () =>
        claimRecord({
          claimStatus: 'APPROVED',
          approvedAmountCents: 100000,
          approvedAt: new Date('2026-06-02T12:00:00Z'),
        }),
      update: async (args: { data: Record<string, unknown> }) => {
        updateArgs = args;
        return claimRecord({
          claimStatus: args.data.claimStatus,
          approvedAmountCents: args.data.approvedAmountCents,
          reimbursedAmountCents: args.data.reimbursedAmountCents,
          reimbursedAt: args.data.reimbursedAt,
          notes: args.data.notes,
          updatedAt: args.data.updatedAt,
          version: 1,
        });
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  try {
    const response = await updateWarrantyClaimHandler({
      pathParameters: { id: 'claim-1' },
      body: JSON.stringify({
        claimStatus: 'REIMBURSED',
        reimbursedAmountCents: 95000,
        notes: ' ACH received ',
      }),
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as {
      claim: { claimStatus: string; reimbursedAmountCents: number; notes: string };
    };
    assert.equal(payload.claim.claimStatus, 'REIMBURSED');
    assert.equal(payload.claim.reimbursedAmountCents, 95000);
    assert.equal(payload.claim.notes, 'ACH received');
    const data = (updateArgs as { data: Record<string, unknown> }).data;
    assert.equal(data.claimStatus, 'REIMBURSED');
    assert.equal(data.reimbursedAmountCents, 95000);
    assert.ok(data.reimbursedAt instanceof Date);
    assert.deepEqual(data.version, { increment: 1 });
  } finally {
    await disconnectWarrantyClaimsHandlerDependencies();
  }
});
