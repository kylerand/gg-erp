import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { LambdaEvent } from '../shared/lambda/handler-wrapper.js';

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

function parseBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

test('listOperationalLedgerHandler builds operational ledger entries from live source records', async () => {
  const { listOperationalLedgerHandler, operationalLedgerQueries } = await import(
    '../lambda/accounting/handlers.js'
  );

  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () =>
      [
        {
          id: 'po-1',
          poNumber: 'PO-1001',
          vendorId: 'vendor-1',
          purchaseOrderState: 'RECEIVED',
          orderedAt: new Date('2026-05-01T12:00:00.000Z'),
          expectedAt: null,
          sentAt: null,
          closedAt: null,
          notes: null,
          correlationId: 'corr-1',
          createdAt: new Date('2026-05-01T12:00:00.000Z'),
          updatedAt: new Date('2026-05-04T12:00:00.000Z'),
          version: 0,
          vendor: { vendorName: 'Acme Parts', vendorCode: 'ACME' },
          lines: [
            {
              id: 'line-1',
              purchaseOrderId: 'po-1',
              lineNumber: 1,
              partId: 'part-1',
              orderedQuantity: 2,
              receivedQuantity: 2,
              rejectedQuantity: 0,
              unitOfMeasureId: 'uom-1',
              unitCost: 125,
              promisedAt: null,
              lineState: 'RECEIVED',
              correlationId: 'corr-1',
              createdAt: new Date('2026-05-01T12:00:00.000Z'),
              updatedAt: new Date('2026-05-04T12:00:00.000Z'),
              version: 0,
              part: { sku: 'BRK-001', name: 'Brake Kit' },
            },
          ],
        },
      ] as unknown as Awaited<
        ReturnType<typeof operationalLedgerQueries.listPayablePurchaseOrders>
      >,
  );
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () =>
      [
        {
          id: 'pay-1',
          invoiceSyncId: 'inv-sync-1',
          workOrderId: 'wo-1',
          customerId: 'cust-1',
          qbPaymentId: 'QB-PAY-1',
          qbInvoiceId: 'QB-INV-1',
          amountCents: 50000,
          paymentMethod: 'Card',
          paymentDate: new Date('2026-05-05T00:00:00.000Z'),
          state: 'SYNCED',
          direction: 'INBOUND',
          errorMessage: null,
          attemptCount: 1,
          lastAttemptAt: new Date('2026-05-05T12:00:00.000Z'),
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
          updatedAt: new Date('2026-05-05T12:00:00.000Z'),
        },
      ] as unknown as Awaited<ReturnType<typeof operationalLedgerQueries.listPaymentSyncRecords>>,
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () =>
      [
        {
          id: 'recon-1',
          reconciliationType: 'PAYMENT',
          erpRecordId: 'pay-1',
          qbRecordId: 'QB-PAY-1',
          status: 'MISMATCH',
          erpAmountCents: 50000,
          qbAmountCents: 45000,
          discrepancy: 'QuickBooks payment is short by $50.',
          resolvedAt: null,
          resolvedBy: null,
          notes: null,
          runId: 'run-1',
          createdAt: new Date('2026-05-06T12:00:00.000Z'),
          updatedAt: new Date('2026-05-06T12:00:00.000Z'),
        },
      ] as unknown as Awaited<
        ReturnType<typeof operationalLedgerQueries.listReconciliationRecords>
      >,
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 1,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 2,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 1,
  );

  try {
    const response = await listOperationalLedgerHandler(
      makeEvent({ queryStringParameters: { limit: '10' } }),
    );
    assert.equal(response.statusCode, 200);

    const body = parseBody(response);
    assert.equal(body.total, 3);
    assert.equal(body.limit, 10);

    const items = body.items as Array<Record<string, unknown>>;
    assert.deepEqual(
      items.map((item) => item.sourceType),
      ['RECONCILIATION_VARIANCE', 'CUSTOMER_PAYMENT', 'PAYABLE_RECEIPT'],
    );
    assert.equal(items[0].status, 'MISMATCH');
    assert.equal(items[1].status, 'POSTED');
    assert.equal(items[2].documentNumber, 'PO-1001');

    const summary = body.summary as Record<string, unknown>;
    assert.equal(summary.totalDebitCents, 80000);
    assert.equal(summary.totalCreditCents, 80000);
    assert.deepEqual(summary.exceptions, {
      invoice: 1,
      customer: 0,
      payment: 2,
      reconciliation: 1,
    });
    assert.equal((body.postingRules as unknown[]).length, 3);
  } finally {
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
  }
});

test('listOperationalLedgerHandler validates source and status filters', async () => {
  const { listOperationalLedgerHandler } = await import('../lambda/accounting/handlers.js');

  const invalidSource = await listOperationalLedgerHandler(
    makeEvent({ queryStringParameters: { sourceType: 'NOT_A_SOURCE' } }),
  );
  assert.equal(invalidSource.statusCode, 422);
  assert.match(String(parseBody(invalidSource).message), /Invalid sourceType/);

  const invalidStatus = await listOperationalLedgerHandler(
    makeEvent({ queryStringParameters: { status: 'NOT_A_STATUS' } }),
  );
  assert.equal(invalidStatus.statusCode, 422);
  assert.match(String(parseBody(invalidStatus).message), /Invalid status/);
});

test('listAccountingJournalsHandler returns posted immutable journals', async () => {
  const { listAccountingJournalsHandler, accountingJournalQueries } = await import(
    '../lambda/accounting/handlers.js'
  );

  const journal = {
    id: '00000000-0000-4000-8000-000000000101',
    journalNumber: 'GJ-PAY-20260505-PAY1',
    sourceType: 'CUSTOMER_PAYMENT',
    sourceId: 'pay-1',
    sourceLedgerEntryId: 'payment-pay-1',
    sourceDocumentNumber: 'QB-PAY-1',
    counterparty: 'cust-1',
    ledgerDate: new Date('2026-05-05T00:00:00.000Z'),
    currencyCode: 'USD',
    status: 'POSTED',
    totalDebitCents: 50000,
    totalCreditCents: 50000,
    memo: 'QuickBooks payment matched.',
    postedAt: new Date('2026-05-05T12:00:00.000Z'),
    postedBy: 'accounting-user',
    correlationId: 'corr-journal',
    createdAt: new Date('2026-05-05T12:00:00.000Z'),
    version: 0,
    lines: [
      {
        id: '00000000-0000-4000-8000-000000000102',
        journalEntryId: '00000000-0000-4000-8000-000000000101',
        lineNumber: 1,
        accountName: 'Undeposited funds / bank clearing',
        accountCode: 'UNDEPOSITED_FUNDS_BANK_CLEARING',
        debitCents: 50000,
        creditCents: 0,
        memo: 'QuickBooks payment matched.',
        dimensionType: 'payment-sync',
        dimensionId: 'pay-1',
        createdAt: new Date('2026-05-05T12:00:00.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-000000000103',
        journalEntryId: '00000000-0000-4000-8000-000000000101',
        lineNumber: 2,
        accountName: 'Accounts receivable',
        accountCode: 'ACCOUNTS_RECEIVABLE',
        debitCents: 0,
        creditCents: 50000,
        memo: 'QuickBooks payment matched.',
        dimensionType: 'payment-sync',
        dimensionId: 'pay-1',
        createdAt: new Date('2026-05-05T12:00:00.000Z'),
      },
    ],
  };

  const listMock = mock.method(accountingJournalQueries, 'list', async () => [journal] as never);
  const countMock = mock.method(accountingJournalQueries, 'count', async () => 1);

  try {
    const response = await listAccountingJournalsHandler(makeEvent());
    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    assert.equal(body.total, 1);
    assert.equal((body.items as Array<Record<string, unknown>>)[0]?.journalNumber, journal.journalNumber);
    assert.equal((body.summary as Record<string, unknown>).totalDebitCents, 50000);
  } finally {
    listMock.mock.restore();
    countMock.mock.restore();
  }
});

test('postOperationalLedgerJournalsHandler requires explicit confirmation', async () => {
  const { postOperationalLedgerJournalsHandler } = await import('../lambda/accounting/handlers.js');

  const response = await postOperationalLedgerJournalsHandler(
    makeEvent({ httpMethod: 'POST', body: '{}' }),
  );

  assert.equal(response.statusCode, 400);
  assert.match(String(parseBody(response).message), /confirm=true/);
});

test('postOperationalLedgerJournalsHandler posts eligible operational entries idempotently', async () => {
  const {
    postOperationalLedgerJournalsHandler,
    operationalLedgerQueries,
    accountingJournalQueries,
  } = await import('../lambda/accounting/handlers.js');

  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () =>
      [
        {
          id: 'po-1',
          poNumber: 'PO-1001',
          vendorId: 'vendor-1',
          purchaseOrderState: 'RECEIVED',
          orderedAt: new Date('2026-05-01T12:00:00.000Z'),
          expectedAt: null,
          sentAt: null,
          closedAt: null,
          notes: null,
          correlationId: 'corr-1',
          createdAt: new Date('2026-05-01T12:00:00.000Z'),
          updatedAt: new Date('2026-05-04T12:00:00.000Z'),
          version: 0,
          vendor: { vendorName: 'Acme Parts', vendorCode: 'ACME' },
          lines: [
            {
              id: 'line-1',
              purchaseOrderId: 'po-1',
              lineNumber: 1,
              partId: 'part-1',
              orderedQuantity: 2,
              receivedQuantity: 2,
              rejectedQuantity: 0,
              unitOfMeasureId: 'uom-1',
              unitCost: 125,
              promisedAt: null,
              lineState: 'RECEIVED',
              correlationId: 'corr-1',
              createdAt: new Date('2026-05-01T12:00:00.000Z'),
              updatedAt: new Date('2026-05-04T12:00:00.000Z'),
              version: 0,
              part: { sku: 'BRK-001', name: 'Brake Kit' },
            },
          ],
        },
      ] as unknown as Awaited<
        ReturnType<typeof operationalLedgerQueries.listPayablePurchaseOrders>
      >,
  );
  const listPaymentsMock = mock.method(operationalLedgerQueries, 'listPaymentSyncRecords', async () => []);
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const invoiceFailuresMock = mock.method(operationalLedgerQueries, 'countInvoiceFailures', async () => 0);
  const customerFailuresMock = mock.method(operationalLedgerQueries, 'countCustomerFailures', async () => 0);
  const paymentFailuresMock = mock.method(operationalLedgerQueries, 'countPaymentFailures', async () => 0);
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 0,
  );
  const findMock = mock.method(accountingJournalQueries, 'findBySource', async () => null);
  const createMock = mock.method(
    accountingJournalQueries,
    'createFromOperationalEntry',
    async (entry: Parameters<typeof accountingJournalQueries.createFromOperationalEntry>[0]) => ({
    id: '00000000-0000-4000-8000-000000000201',
    journalNumber: 'GJ-AP-20260504-PO1',
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceLedgerEntryId: entry.id,
    sourceDocumentNumber: entry.documentNumber,
    counterparty: entry.counterparty,
    ledgerDate: new Date(entry.ledgerDate),
    currencyCode: 'USD',
    status: 'POSTED',
    totalDebitCents: entry.debitCents,
    totalCreditCents: entry.creditCents,
    memo: entry.memo,
    postedAt: new Date('2026-05-04T12:00:00.000Z'),
    postedBy: 'system',
    correlationId: 'corr-post',
    createdAt: new Date('2026-05-04T12:00:00.000Z'),
    version: 0,
    lines: [
      {
        id: '00000000-0000-4000-8000-000000000202',
        journalEntryId: '00000000-0000-4000-8000-000000000201',
        lineNumber: 1,
        accountName: entry.accountDebit,
        accountCode: 'INVENTORY_RECEIVED_NOT_BILLED',
        debitCents: entry.debitCents,
        creditCents: 0,
        memo: entry.memo,
        dimensionType: entry.relatedRecordType,
        dimensionId: entry.relatedRecordId,
        createdAt: new Date('2026-05-04T12:00:00.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-000000000203',
        journalEntryId: '00000000-0000-4000-8000-000000000201',
        lineNumber: 2,
        accountName: entry.accountCredit,
        accountCode: 'ACCOUNTS_PAYABLE_UNBILLED',
        debitCents: 0,
        creditCents: entry.creditCents,
        memo: entry.memo,
        dimensionType: entry.relatedRecordType,
        dimensionId: entry.relatedRecordId,
        createdAt: new Date('2026-05-04T12:00:00.000Z'),
      },
    ],
    }) as never,
  );

  try {
    const response = await postOperationalLedgerJournalsHandler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ confirm: true, sourceType: 'PAYABLE_RECEIPT' }),
      }),
    );
    assert.equal(response.statusCode, 201);
    const body = parseBody(response);
    assert.equal(body.postedCount, 1);
    assert.equal((body.posted as Array<Record<string, unknown>>)[0]?.sourceLedgerEntryId, 'payable-po-1');
    assert.equal((body.skipped as Record<string, unknown>).existing, 0);
  } finally {
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
    findMock.mock.restore();
    createMock.mock.restore();
  }
});
