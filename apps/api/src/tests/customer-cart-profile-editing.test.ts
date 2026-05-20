import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  disconnectCustomersHandlerDependencies,
  setCustomersHandlerPrismaForTests,
  updateCustomerHandler,
} from '../lambda/customers/handlers.js';
import {
  disconnectVehiclesHandlerDependencies,
  setVehiclesHandlerPrismaForTests,
  updateVehicleHandler,
} from '../lambda/vehicles/handlers.js';

const now = new Date('2026-05-20T12:00:00.000Z');

test.afterEach(async () => {
  await disconnectCustomersHandlerDependencies();
  await disconnectVehiclesHandlerDependencies();
});

test('updateCustomerHandler patches contact and address profile fields', async () => {
  const existing = {
    id: '00000000-0000-4000-8000-000000000001',
    state: 'ACTIVE',
    fullName: 'Original Customer',
    companyName: 'Original Co',
    email: 'old@example.com',
    phone: '555-0100',
    billingAddress: null,
    shippingAddress: null,
    preferredContactMethod: 'EMAIL',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    externalReference: 'CUST-1',
  };
  let updateArgs: unknown;
  setCustomersHandlerPrismaForTests({
    customer: {
      findUnique: async () => existing,
      findFirst: async () => null,
      update: async (args: { data: Record<string, unknown> }) => {
        updateArgs = args;
        return { ...existing, ...args.data, updatedAt: now };
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  const response = await updateCustomerHandler({
    pathParameters: { id: existing.id },
    body: JSON.stringify({
      fullName: '  Riverside Golf Club  ',
      email: '  OPS@RIVERSIDE.COM ',
      phone: '',
      preferredContactMethod: 'sms',
      billingAddress: '  100 Fairway Dr  ',
      shippingAddress: '',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    (updateArgs as { data: Record<string, unknown> }).data,
    {
      fullName: 'Riverside Golf Club',
      email: 'ops@riverside.com',
      preferredContactMethod: 'SMS',
      phone: null,
      billingAddress: '100 Fairway Dr',
      shippingAddress: null,
      updatedAt: (updateArgs as { data: { updatedAt: Date } }).data.updatedAt,
      version: { increment: 1 },
    },
  );
  const payload = JSON.parse(response.body) as { customer: { email: string; phone?: string } };
  assert.equal(payload.customer.email, 'ops@riverside.com');
  assert.equal(payload.customer.phone, undefined);
});

test('updateCustomerHandler rejects duplicate active customer email', async () => {
  setCustomersHandlerPrismaForTests({
    customer: {
      findUnique: async () => ({
        id: '00000000-0000-4000-8000-000000000001',
        state: 'ACTIVE',
        fullName: 'Customer',
        companyName: null,
        email: 'old@example.com',
        phone: null,
        billingAddress: null,
        shippingAddress: null,
        preferredContactMethod: 'EMAIL',
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        externalReference: null,
      }),
      findFirst: async () => ({ id: 'duplicate' }),
      update: async () => {
        throw new Error('update should not be called');
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  const response = await updateCustomerHandler({
    pathParameters: { id: '00000000-0000-4000-8000-000000000001' },
    body: JSON.stringify({ email: 'duplicate@example.com' }),
  });

  assert.equal(response.statusCode, 409);
});

test('updateVehicleHandler patches cart identity fields', async () => {
  const existing = {
    id: '00000000-0000-4000-8000-000000000002',
    vin: 'VIN-OLD',
    serialNumber: 'SER-OLD',
    modelCode: 'DS',
    modelYear: 2019,
    customerId: '00000000-0000-4000-8000-000000000001',
    state: 'REGISTERED',
    createdAt: now,
    updatedAt: now,
  };
  let updateArgs: unknown;
  setVehiclesHandlerPrismaForTests({
    cartVehicle: {
      findUnique: async () => existing,
      findFirst: async () => null,
      update: async (args: { data: Record<string, unknown> }) => {
        updateArgs = args;
        return { ...existing, ...args.data, updatedAt: now };
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  const response = await updateVehicleHandler({
    pathParameters: { id: existing.id },
    body: JSON.stringify({
      vin: ' VIN-NEW ',
      serialNumber: ' SER-NEW ',
      modelCode: ' Tempo ',
      modelYear: 2024,
      state: 'in_build',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    (updateArgs as { data: Record<string, unknown> }).data,
    {
      vin: 'VIN-NEW',
      serialNumber: 'SER-NEW',
      modelCode: 'Tempo',
      modelYear: 2024,
      state: 'IN_BUILD',
      updatedAt: (updateArgs as { data: { updatedAt: Date } }).data.updatedAt,
    },
  );
  const payload = JSON.parse(response.body) as { vehicle: { state: string; modelYear: number } };
  assert.equal(payload.vehicle.state, 'IN_BUILD');
  assert.equal(payload.vehicle.modelYear, 2024);
});

test('updateVehicleHandler validates model year before writing', async () => {
  setVehiclesHandlerPrismaForTests({
    cartVehicle: {
      findUnique: async () => ({
        id: '00000000-0000-4000-8000-000000000002',
        vin: 'VIN-OLD',
        serialNumber: 'SER-OLD',
        modelCode: 'DS',
        modelYear: 2019,
        customerId: '00000000-0000-4000-8000-000000000001',
        state: 'REGISTERED',
        createdAt: now,
        updatedAt: now,
      }),
      findFirst: async () => null,
      update: async () => {
        throw new Error('update should not be called');
      },
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient);

  const response = await updateVehicleHandler({
    pathParameters: { id: '00000000-0000-4000-8000-000000000002' },
    body: JSON.stringify({ modelYear: 1800 }),
  });

  assert.equal(response.statusCode, 422);
});
