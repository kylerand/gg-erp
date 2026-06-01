/**
 * Tests for the service-backed invoice sync and customer sync Lambda handlers.
 *
 * Uses Node.js built-in test runner with mock.method to stub the Prisma
 * singleton and service query objects used by the handlers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type { LambdaEvent } from '../shared/lambda/handler-wrapper.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<LambdaEvent> = {}): LambdaEvent {
  return {
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
    pathParameters: {},
    body: null,
    ...overrides,
  };
}

function parseResponseBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

// ─── Invoice Sync: listInvoiceSyncsHandler ────────────────────────────────────

test('listInvoiceSyncsHandler returns paginated invoice sync records', async () => {
  const { listInvoiceSyncsHandler, invoiceSyncListQueries, accountingSyncContextQueries } =
    await import('../lambda/accounting/handlers.js');

  const now = new Date();
  const mockRecords = [
    {
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      workOrderId: 'wo-1',
      provider: 'QUICKBOOKS',
      state: 'PENDING',
      attemptCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      externalReference: null,
      createdAt: now,
      syncedAt: null,
    },
  ];

  const findManyMock = mock.method(invoiceSyncListQueries, 'findMany', async () => mockRecords);
  const countMock = mock.method(invoiceSyncListQueries, 'count', async () => 1);
  const findWorkOrdersMock = mock.method(
    accountingSyncContextQueries,
    'findWorkOrders',
    async () => [
      {
        id: 'wo-1',
        workOrderNumber: 'WO-2026-0001',
        state: 'IN_PROGRESS',
        scheduledStartAt: null,
      },
    ],
  );

  try {
    const event = makeEvent({
      httpMethod: 'GET',
      queryStringParameters: { state: 'PENDING', limit: '50', offset: '0' },
    });

    const response = await listInvoiceSyncsHandler(event);
    assert.equal(response.statusCode, 200);

    const body = parseResponseBody(response);
    assert.equal(body.total, 1);
    assert.equal(body.limit, 50);
    assert.equal(body.offset, 0);

    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'inv-1');
    assert.equal(items[0].state, 'PENDING');
    assert.equal(items[0].invoiceNumber, 'INV-001');
    assert.deepEqual(items[0].workOrder, {
      id: 'wo-1',
      workOrderNumber: 'WO-2026-0001',
      state: 'IN_PROGRESS',
      scheduledStartAt: null,
    });

    assert.equal(findManyMock.mock.calls.length, 1);
    assert.equal(countMock.mock.calls.length, 1);
    assert.deepEqual(findWorkOrdersMock.mock.calls[0].arguments[0], ['wo-1']);
  } finally {
    findManyMock.mock.restore();
    countMock.mock.restore();
    findWorkOrdersMock.mock.restore();
  }
});

test('listInvoiceSyncsHandler rejects invalid state filter', async () => {
  const { listInvoiceSyncsHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'GET',
    queryStringParameters: { state: 'INVALID_STATE' },
  });

  const response = await listInvoiceSyncsHandler(event);
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Invalid state filter'));
});

// ─── Invoice Sync: triggerInvoiceSyncHandler ──────────────────────────────────

test('triggerInvoiceSyncHandler creates a sync record via the service', async () => {
  const { triggerInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { invoiceSyncQueries } = await import('../contexts/accounting/invoiceSync.service.js');

  const findByInvoiceNumberMock = mock.method(
    invoiceSyncQueries,
    'findByInvoiceNumber',
    async () => undefined,
  );
  const saveMock = mock.method(invoiceSyncQueries, 'save', async () => undefined);
  const snapshotMock = mock.method(
    invoiceSyncQueries,
    'captureDocumentSnapshot',
    async () => undefined,
  );

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ workOrderId: 'wo-123', invoiceNumber: 'INV-100' }),
    });

    const response = await triggerInvoiceSyncHandler(event);
    assert.equal(response.statusCode, 202);

    const body = parseResponseBody(response);
    assert.equal(body.state, 'PENDING');
    assert.equal(body.message, 'Invoice sync queued.');
    assert.ok(body.id);

    assert.equal(findByInvoiceNumberMock.mock.calls.length, 1);
    assert.equal(saveMock.mock.calls.length, 1);
    assert.equal(snapshotMock.mock.calls.length, 1);
  } finally {
    findByInvoiceNumberMock.mock.restore();
    saveMock.mock.restore();
    snapshotMock.mock.restore();
  }
});

test('triggerInvoiceSyncHandler returns 422 when workOrderId is missing', async () => {
  const { triggerInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'POST',
    body: JSON.stringify({ invoiceNumber: 'INV-100' }),
  });

  const response = await triggerInvoiceSyncHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('workOrderId'));
});

test('triggerInvoiceSyncHandler returns 422 when invoiceNumber is missing', async () => {
  const { triggerInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'POST',
    body: JSON.stringify({ workOrderId: 'wo-123' }),
  });

  const response = await triggerInvoiceSyncHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('invoiceNumber'));
});

test('triggerInvoiceSyncHandler returns 400 when body is missing', async () => {
  const { triggerInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({ httpMethod: 'POST', body: null });

  const response = await triggerInvoiceSyncHandler(event);
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('body'));
});

test('triggerInvoiceSyncHandler returns 409 for duplicate invoice number', async () => {
  const { triggerInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { invoiceSyncQueries } = await import('../contexts/accounting/invoiceSync.service.js');

  const existingRecord = {
    id: 'existing-1',
    invoiceNumber: 'INV-DUP',
    workOrderId: 'wo-old',
    provider: 'QUICKBOOKS' as const,
    state: 'PENDING' as const,
    attemptCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const findByInvoiceNumberMock = mock.method(
    invoiceSyncQueries,
    'findByInvoiceNumber',
    async () => existingRecord,
  );

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ workOrderId: 'wo-new', invoiceNumber: 'INV-DUP' }),
    });

    const response = await triggerInvoiceSyncHandler(event);
    assert.equal(response.statusCode, 409);

    const body = parseResponseBody(response);
    assert.ok((body.message as string).includes('already exists'));
  } finally {
    findByInvoiceNumberMock.mock.restore();
  }
});

// ─── Invoice Sync: retryInvoiceSyncHandler ────────────────────────────────────

test('retryInvoiceSyncHandler returns 400 when ID is missing', async () => {
  const { retryInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({ httpMethod: 'POST', pathParameters: {} });

  const response = await retryInvoiceSyncHandler(event);
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Sync record ID'));
});

test('retryInvoiceSyncHandler returns 404 when record does not exist', async () => {
  const { retryInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { invoiceSyncQueries } = await import('../contexts/accounting/invoiceSync.service.js');

  const findByIdMock = mock.method(invoiceSyncQueries, 'findById', async () => undefined);

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      pathParameters: { id: 'nonexistent-id' },
    });

    const response = await retryInvoiceSyncHandler(event);
    assert.equal(response.statusCode, 404);

    const body = parseResponseBody(response);
    assert.ok((body.message as string).includes('not found'));
  } finally {
    findByIdMock.mock.restore();
  }
});

test('retryInvoiceSyncHandler returns 409 for non-retryable state', async () => {
  const { retryInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { invoiceSyncQueries } = await import('../contexts/accounting/invoiceSync.service.js');

  const findByIdMock = mock.method(invoiceSyncQueries, 'findById', async () => ({
    id: 'sync-1',
    invoiceNumber: 'INV-001',
    workOrderId: 'wo-1',
    provider: 'QUICKBOOKS' as const,
    state: 'SYNCED' as const,
    attemptCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      pathParameters: { id: 'sync-1' },
    });

    const response = await retryInvoiceSyncHandler(event);
    assert.equal(response.statusCode, 409);

    const body = parseResponseBody(response);
    assert.ok((body.message as string).includes('Cannot retry'));
  } finally {
    findByIdMock.mock.restore();
  }
});

test('retryInvoiceSyncHandler retries a FAILED record successfully', async () => {
  const { retryInvoiceSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { invoiceSyncQueries } = await import('../contexts/accounting/invoiceSync.service.js');

  const failedRecord = {
    id: 'sync-fail-1',
    invoiceNumber: 'INV-002',
    workOrderId: 'wo-2',
    provider: 'QUICKBOOKS' as const,
    state: 'FAILED' as const,
    attemptCount: 1,
    lastErrorCode: 'QB_ERROR',
    lastErrorMessage: 'Something went wrong',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const findByIdMock = mock.method(invoiceSyncQueries, 'findById', async () => ({
    ...failedRecord,
  }));
  const saveMock = mock.method(invoiceSyncQueries, 'save', async () => undefined);
  const snapshotMock = mock.method(
    invoiceSyncQueries,
    'captureDocumentSnapshot',
    async () => undefined,
  );

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      pathParameters: { id: 'sync-fail-1' },
    });

    const response = await retryInvoiceSyncHandler(event);
    assert.equal(response.statusCode, 200);

    const body = parseResponseBody(response);
    assert.equal(body.id, 'sync-fail-1');
    assert.equal(body.state, 'IN_PROGRESS');
    assert.equal(body.message, 'Sync record queued for retry.');
  } finally {
    findByIdMock.mock.restore();
    saveMock.mock.restore();
    snapshotMock.mock.restore();
  }
});

// ─── Customer Sync: listCustomerSyncsHandler ─────────────────────────────────

test('listCustomerSyncsHandler returns paginated customer sync records', async () => {
  const { listCustomerSyncsHandler, customerSyncListQueries, accountingSyncContextQueries } =
    await import('../lambda/accounting/handlers.js');

  const now = new Date();
  const mockRecords = [
    {
      id: 'cust-sync-1',
      customerId: 'cust-1',
      provider: 'QUICKBOOKS',
      state: 'SYNCED',
      attemptCount: 1,
      lastErrorCode: null,
      lastErrorMessage: null,
      externalReference: 'qb-cust-1',
      createdAt: now,
      syncedAt: now,
    },
  ];

  const findManyMock = mock.method(customerSyncListQueries, 'findMany', async () => mockRecords);
  const countMock = mock.method(customerSyncListQueries, 'count', async () => 1);
  const findCustomersMock = mock.method(accountingSyncContextQueries, 'findCustomers', async () => [
    {
      id: 'cust-1',
      displayName: 'Acme Cart Works',
      fullName: 'Avery Customer',
      companyName: 'Acme Cart Works',
      email: 'avery@example.com',
      phone: null,
      state: 'ACTIVE',
    },
  ]);

  try {
    const event = makeEvent({
      httpMethod: 'GET',
      queryStringParameters: { state: 'SYNCED' },
    });

    const response = await listCustomerSyncsHandler(event);
    assert.equal(response.statusCode, 200);

    const body = parseResponseBody(response);
    assert.equal(body.total, 1);

    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'cust-sync-1');
    assert.equal(items[0].state, 'SYNCED');
    assert.equal(items[0].customerId, 'cust-1');
    assert.deepEqual(items[0].customer, {
      id: 'cust-1',
      displayName: 'Acme Cart Works',
      fullName: 'Avery Customer',
      companyName: 'Acme Cart Works',
      email: 'avery@example.com',
      phone: null,
      state: 'ACTIVE',
    });
    assert.equal(items[0].externalReference, 'qb-cust-1');

    assert.equal(findManyMock.mock.calls.length, 1);
    assert.equal(countMock.mock.calls.length, 1);
    assert.deepEqual(findCustomersMock.mock.calls[0].arguments[0], ['cust-1']);
  } finally {
    findManyMock.mock.restore();
    countMock.mock.restore();
    findCustomersMock.mock.restore();
  }
});

test('listCustomerSyncsHandler rejects invalid state filter', async () => {
  const { listCustomerSyncsHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'GET',
    queryStringParameters: { state: 'BOGUS' },
  });

  const response = await listCustomerSyncsHandler(event);
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Invalid state filter'));
});

// ─── Customer Sync: triggerCustomerSyncHandler ────────────────────────────────

test('triggerCustomerSyncHandler creates a sync record', async () => {
  const { triggerCustomerSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { customerSyncQueries } = await import('../contexts/accounting/customerSync.service.js');

  const findByCustomerAndProviderMock = mock.method(
    customerSyncQueries,
    'findByCustomerAndProvider',
    async () => undefined,
  );
  const saveMock = mock.method(customerSyncQueries, 'save', async () => undefined);

  try {
    const event = makeEvent({
      httpMethod: 'POST',
      body: JSON.stringify({
        customerId: 'cust-new',
        displayName: 'New Customer LLC',
        integrationAccountId: 'int-001',
      }),
    });

    const response = await triggerCustomerSyncHandler(event);
    assert.equal(response.statusCode, 202);

    const body = parseResponseBody(response);
    assert.equal(body.state, 'PENDING');
    assert.equal(body.message, 'Customer sync queued.');
    assert.ok(body.id);
  } finally {
    findByCustomerAndProviderMock.mock.restore();
    saveMock.mock.restore();
  }
});

test('triggerCustomerSyncHandler returns 422 when customerId is missing', async () => {
  const { triggerCustomerSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'POST',
    body: JSON.stringify({ displayName: 'Foo', integrationAccountId: 'int-001' }),
  });

  const response = await triggerCustomerSyncHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('customerId'));
});

test('triggerCustomerSyncHandler returns 422 when displayName is missing', async () => {
  const { triggerCustomerSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'POST',
    body: JSON.stringify({ customerId: 'c-1', integrationAccountId: 'int-001' }),
  });

  const response = await triggerCustomerSyncHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('displayName'));
});

test('triggerCustomerSyncHandler returns 422 when integrationAccountId is missing', async () => {
  const { triggerCustomerSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({
    httpMethod: 'POST',
    body: JSON.stringify({ customerId: 'c-1', displayName: 'Foo' }),
  });

  const response = await triggerCustomerSyncHandler(event);
  assert.equal(response.statusCode, 422);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('integrationAccountId'));
});

test('triggerCustomerSyncHandler returns 400 when body is empty', async () => {
  const { triggerCustomerSyncHandler } = await import('../lambda/accounting/handlers.js');

  const event = makeEvent({ httpMethod: 'POST', body: '' });

  const response = await triggerCustomerSyncHandler(event);
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('body'));
});

// ─── Payment Sync: listPaymentSyncsHandler ───────────────────────────────────

test('listPaymentSyncsHandler returns payment sync rows with work order and customer context', async () => {
  const { listPaymentSyncsHandler, paymentSyncListQueries, accountingSyncContextQueries } =
    await import('../lambda/accounting/handlers.js');

  const now = new Date('2026-05-31T12:00:00.000Z');
  const mockRecords = [
    {
      id: 'pay-sync-1',
      invoiceSyncId: 'inv-sync-1',
      workOrderId: 'wo-1',
      customerId: 'cust-1',
      qbPaymentId: 'qb-pay-1',
      qbInvoiceId: 'qb-inv-1',
      amountCents: 129900,
      paymentMethod: 'Card',
      paymentDate: now,
      state: 'FAILED',
      direction: 'INBOUND',
      errorMessage: 'Customer lookup failed',
      attemptCount: 2,
      lastAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const findManyMock = mock.method(paymentSyncListQueries, 'findMany', async () => mockRecords);
  const countMock = mock.method(paymentSyncListQueries, 'count', async () => 1);
  const findWorkOrdersMock = mock.method(
    accountingSyncContextQueries,
    'findWorkOrders',
    async () => [
      {
        id: 'wo-1',
        workOrderNumber: 'WO-2026-1001',
        state: 'READY',
        scheduledStartAt: null,
      },
    ],
  );
  const findCustomersMock = mock.method(accountingSyncContextQueries, 'findCustomers', async () => [
    {
      id: 'cust-1',
      displayName: 'Acme Cart Works',
      fullName: 'Avery Customer',
      companyName: 'Acme Cart Works',
      email: 'avery@example.com',
      phone: null,
      state: 'ACTIVE',
    },
  ]);

  try {
    const response = await listPaymentSyncsHandler(
      makeEvent({
        httpMethod: 'GET',
        queryStringParameters: { state: 'FAILED', limit: '25', offset: '0' },
      }),
    );

    assert.equal(response.statusCode, 200);
    const body = parseResponseBody(response);
    assert.equal(body.total, 1);
    assert.equal(body.limit, 25);

    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'pay-sync-1');
    assert.equal(items[0].state, 'FAILED');
    assert.equal(items[0].amountCents, 129900);
    assert.equal(items[0].errorMessage, 'Customer lookup failed');
    assert.deepEqual(items[0].workOrder, {
      id: 'wo-1',
      workOrderNumber: 'WO-2026-1001',
      state: 'READY',
      scheduledStartAt: null,
    });
    assert.deepEqual(items[0].customer, {
      id: 'cust-1',
      displayName: 'Acme Cart Works',
      fullName: 'Avery Customer',
      companyName: 'Acme Cart Works',
      email: 'avery@example.com',
      phone: null,
      state: 'ACTIVE',
    });

    assert.equal(findManyMock.mock.calls.length, 1);
    assert.equal(countMock.mock.calls.length, 1);
    assert.deepEqual(findWorkOrdersMock.mock.calls[0].arguments[0], ['wo-1']);
    assert.deepEqual(findCustomersMock.mock.calls[0].arguments[0], ['cust-1']);
  } finally {
    findManyMock.mock.restore();
    countMock.mock.restore();
    findWorkOrdersMock.mock.restore();
    findCustomersMock.mock.restore();
  }
});

test('listPaymentSyncsHandler rejects invalid state filter', async () => {
  const { listPaymentSyncsHandler } = await import('../lambda/accounting/handlers.js');

  const response = await listPaymentSyncsHandler(
    makeEvent({
      httpMethod: 'GET',
      queryStringParameters: { state: 'NOPE' },
    }),
  );
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Invalid state filter'));
});

// ─── Payment Sync: retryPaymentSyncHandler ───────────────────────────────────

test('retryPaymentSyncHandler returns 400 when ID is missing', async () => {
  const { retryPaymentSyncHandler } = await import('../lambda/accounting/handlers.js');

  const response = await retryPaymentSyncHandler(makeEvent({ httpMethod: 'POST' }));
  assert.equal(response.statusCode, 400);

  const body = parseResponseBody(response);
  assert.ok((body.message as string).includes('Payment sync record ID'));
});

test('retryPaymentSyncHandler returns 404 when record does not exist', async () => {
  const { retryPaymentSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { paymentSyncQueries } = await import('../contexts/accounting/paymentSync.service.js');

  const findByIdMock = mock.method(paymentSyncQueries, 'findById', async () => undefined);

  try {
    const response = await retryPaymentSyncHandler(
      makeEvent({ httpMethod: 'POST', pathParameters: { id: 'missing-payment' } }),
    );
    assert.equal(response.statusCode, 404);

    const body = parseResponseBody(response);
    assert.ok((body.message as string).includes('not found'));
  } finally {
    findByIdMock.mock.restore();
  }
});

test('retryPaymentSyncHandler returns 409 for non-failed payment records', async () => {
  const { retryPaymentSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { paymentSyncQueries } = await import('../contexts/accounting/paymentSync.service.js');

  const now = new Date('2026-05-31T12:00:00.000Z').toISOString();
  const findByIdMock = mock.method(paymentSyncQueries, 'findById', async () => ({
    id: 'pay-sync-synced',
    workOrderId: 'wo-1',
    customerId: 'cust-1',
    amountCents: 5000,
    state: 'SYNCED' as const,
    direction: 'INBOUND' as const,
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const response = await retryPaymentSyncHandler(
      makeEvent({ httpMethod: 'POST', pathParameters: { id: 'pay-sync-synced' } }),
    );
    assert.equal(response.statusCode, 409);

    const body = parseResponseBody(response);
    assert.ok((body.message as string).includes('Cannot retry'));
  } finally {
    findByIdMock.mock.restore();
  }
});

test('retryPaymentSyncHandler transitions failed payments back into progress', async () => {
  const { retryPaymentSyncHandler } = await import('../lambda/accounting/handlers.js');
  const { paymentSyncQueries } = await import('../contexts/accounting/paymentSync.service.js');

  const now = new Date('2026-05-31T12:00:00.000Z').toISOString();
  const failedRecord = {
    id: 'pay-sync-failed',
    workOrderId: 'wo-1',
    customerId: 'cust-1',
    qbPaymentId: 'qb-pay-1',
    qbInvoiceId: 'qb-inv-1',
    amountCents: 5000,
    paymentMethod: 'Card',
    paymentDate: '2026-05-31',
    state: 'FAILED' as const,
    direction: 'INBOUND' as const,
    errorMessage: 'Previous failure',
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  const findByIdMock = mock.method(paymentSyncQueries, 'findById', async () => failedRecord);
  const saveMock = mock.method(paymentSyncQueries, 'save', async () => undefined);
  const snapshotMock = mock.method(
    paymentSyncQueries,
    'captureDocumentSnapshot',
    async () => undefined,
  );

  try {
    const response = await retryPaymentSyncHandler(
      makeEvent({ httpMethod: 'POST', pathParameters: { id: 'pay-sync-failed' } }),
    );
    assert.equal(response.statusCode, 200);

    const body = parseResponseBody(response);
    assert.equal(body.id, 'pay-sync-failed');
    assert.equal(body.state, 'IN_PROGRESS');
    assert.equal(body.message, 'Payment sync queued for retry.');

    const saved = saveMock.mock.calls[0].arguments[0] as unknown as Record<string, unknown>;
    assert.equal(saved.state, 'IN_PROGRESS');
    assert.equal(saved.attemptCount, 2);
    assert.equal(saved.errorMessage, undefined);
    assert.equal(snapshotMock.mock.calls.length, 1);
  } finally {
    findByIdMock.mock.restore();
    saveMock.mock.restore();
    snapshotMock.mock.restore();
  }
});

// ─── CORS / OPTIONS preflight ─────────────────────────────────────────────────

test('all handlers return 204 for OPTIONS preflight', async () => {
  const {
    listInvoiceSyncsHandler,
    triggerInvoiceSyncHandler,
    retryInvoiceSyncHandler,
    listCustomerSyncsHandler,
    triggerCustomerSyncHandler,
    listPaymentSyncsHandler,
    retryPaymentSyncHandler,
  } = await import('../lambda/accounting/handlers.js');

  const optionsEvent = makeEvent({ httpMethod: 'OPTIONS' });

  for (const handler of [
    listInvoiceSyncsHandler,
    triggerInvoiceSyncHandler,
    retryInvoiceSyncHandler,
    listCustomerSyncsHandler,
    triggerCustomerSyncHandler,
    listPaymentSyncsHandler,
    retryPaymentSyncHandler,
  ]) {
    const response = await handler(optionsEvent);
    assert.equal(response.statusCode, 204, `OPTIONS should return 204`);
    assert.ok(
      response.headers['access-control-allow-methods']?.includes('POST'),
      'Should include CORS methods header',
    );
  }
});
