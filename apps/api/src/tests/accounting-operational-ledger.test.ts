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
  const { listOperationalLedgerHandler, operationalLedgerQueries } =
    await import('../lambda/accounting/handlers.js');

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
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () =>
      [
        {
          id: 'claim-1',
          claimNumber: 'WCLM-20260602-ABC123',
          customerId: 'cust-1',
          dealerAccountId: 'dealer-1',
          dealerRelationshipId: null,
          cartVehicleId: 'cart-1',
          workOrderId: 'wo-1',
          claimStatus: 'APPROVED',
          requestedAmountCents: 35000,
          approvedAmountCents: 30000,
          reimbursedAmountCents: null,
          externalReference: 'WR-EXT-1',
          claimReason: 'Warranty service',
          ownerUserId: null,
          notes: null,
          submittedAt: new Date('2026-06-01T12:00:00.000Z'),
          approvedAt: new Date('2026-06-02T12:00:00.000Z'),
          reimbursedAt: null,
          closedAt: null,
          correlationId: 'corr-warranty',
          createdAt: new Date('2026-06-01T12:00:00.000Z'),
          updatedAt: new Date('2026-06-02T12:00:00.000Z'),
          version: 0,
          customer: {
            fullName: 'Customer One',
            companyName: null,
            email: 'customer@example.com',
          },
          dealerAccount: {
            id: 'dealer-1',
            customerId: 'dealer-customer-1',
            dealerCode: 'DLR',
            territory: 'Southeast',
            serviceRelationship: 'ACTIVE',
            accountOwner: null,
            notes: null,
            createdAt: new Date('2026-05-01T12:00:00.000Z'),
            updatedAt: new Date('2026-05-01T12:00:00.000Z'),
            archivedAt: null,
            version: 0,
            customer: {
              fullName: 'Dealer One',
              companyName: 'Dealer One LLC',
              email: 'dealer@example.com',
            },
          },
          dealerRelationship: null,
          cartVehicle: {
            serialNumber: 'GG-1001',
            modelCode: 'GT',
            modelYear: 2026,
          },
          workOrder: {
            workOrderNumber: 'WO-1001',
            status: 'IN_PROGRESS',
            dueAt: new Date('2026-06-05T12:00:00.000Z'),
          },
        },
      ] as unknown as Awaited<ReturnType<typeof operationalLedgerQueries.listWarrantyClaims>>,
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
    assert.equal(body.total, 4);
    assert.equal(body.limit, 10);

    const items = body.items as Array<Record<string, unknown>>;
    assert.deepEqual(
      items.map((item) => item.sourceType),
      ['WARRANTY_REIMBURSEMENT', 'RECONCILIATION_VARIANCE', 'CUSTOMER_PAYMENT', 'PAYABLE_RECEIPT'],
    );
    assert.equal(items[0].status, 'READY_FOR_REVIEW');
    assert.equal(items[0].documentNumber, 'WCLM-20260602-ABC123');
    assert.equal(items[1].status, 'MISMATCH');
    assert.equal(items[2].status, 'POSTED');
    assert.equal(items[3].documentNumber, 'PO-1001');

    const summary = body.summary as Record<string, unknown>;
    assert.equal(summary.totalDebitCents, 110000);
    assert.equal(summary.totalCreditCents, 110000);
    assert.deepEqual(summary.exceptions, {
      invoice: 1,
      customer: 0,
      payment: 2,
      reconciliation: 1,
    });
    assert.equal((body.postingRules as unknown[]).length, 4);
  } finally {
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
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
  const { listAccountingJournalsHandler, accountingJournalQueries } =
    await import('../lambda/accounting/handlers.js');

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
    assert.equal(
      (body.items as Array<Record<string, unknown>>)[0]?.journalNumber,
      journal.journalNumber,
    );
    assert.equal((body.summary as Record<string, unknown>).totalDebitCents, 50000);
  } finally {
    listMock.mock.restore();
    countMock.mock.restore();
  }
});

test('getAccountingTrialBalanceHandler groups posted journal lines and close checks', async () => {
  const { getAccountingTrialBalanceHandler, accountingReportQueries, operationalLedgerQueries } =
    await import('../lambda/accounting/handlers.js');

  const journal = {
    id: '00000000-0000-4000-8000-000000000301',
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
        id: '00000000-0000-4000-8000-000000000302',
        journalEntryId: '00000000-0000-4000-8000-000000000301',
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
        id: '00000000-0000-4000-8000-000000000303',
        journalEntryId: '00000000-0000-4000-8000-000000000301',
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

  const reportJournalsMock = mock.method(
    accountingReportQueries,
    'listPostedJournals',
    async () => [journal] as never,
  );
  const reportCountMock = mock.method(
    accountingReportQueries,
    'countPostedJournals',
    async () => 1,
  );
  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () => [],
  );
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () =>
      [
        {
          id: 'pay-2',
          invoiceSyncId: 'inv-sync-2',
          workOrderId: 'wo-2',
          customerId: 'cust-2',
          qbPaymentId: 'QB-PAY-2',
          qbInvoiceId: 'QB-INV-2',
          amountCents: 10000,
          paymentMethod: 'Card',
          paymentDate: new Date('2026-05-06T00:00:00.000Z'),
          state: 'SYNCED',
          direction: 'INBOUND',
          errorMessage: null,
          attemptCount: 1,
          lastAttemptAt: new Date('2026-05-06T12:00:00.000Z'),
          createdAt: new Date('2026-05-06T12:00:00.000Z'),
          updatedAt: new Date('2026-05-06T12:00:00.000Z'),
        },
        {
          id: 'pay-3',
          invoiceSyncId: 'inv-sync-3',
          workOrderId: 'wo-3',
          customerId: 'cust-3',
          qbPaymentId: 'QB-PAY-3',
          qbInvoiceId: 'QB-INV-3',
          amountCents: 7500,
          paymentMethod: 'Card',
          paymentDate: new Date('2026-05-07T00:00:00.000Z'),
          state: 'FAILED',
          direction: 'INBOUND',
          errorMessage: 'Payment failed to sync.',
          attemptCount: 2,
          lastAttemptAt: new Date('2026-05-07T12:00:00.000Z'),
          createdAt: new Date('2026-05-07T12:00:00.000Z'),
          updatedAt: new Date('2026-05-07T12:00:00.000Z'),
        },
      ] as unknown as Awaited<ReturnType<typeof operationalLedgerQueries.listPaymentSyncRecords>>,
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () => [],
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 0,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 1,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 1,
  );

  try {
    const response = await getAccountingTrialBalanceHandler(
      makeEvent({ queryStringParameters: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    const summary = body.summary as Record<string, unknown>;
    assert.equal(summary.totalDebitCents, 50000);
    assert.equal(summary.totalCreditCents, 50000);
    assert.equal(summary.accountCount, 2);
    assert.equal(summary.unpostedOperationalCount, 1);
    assert.equal(summary.reviewItemCount, 1);
    assert.equal(summary.integrationExceptionCount, 2);
    assert.equal(summary.closeStatus, 'BLOCKED');

    const lines = body.accountLines as Array<Record<string, unknown>>;
    assert.deepEqual(lines.map((line) => line.accountCode).sort(), [
      'ACCOUNTS_RECEIVABLE',
      'UNDEPOSITED_FUNDS_BANK_CLEARING',
    ]);
    assert.equal((body.closeChecks as Array<Record<string, unknown>>).length, 5);
  } finally {
    reportJournalsMock.mock.restore();
    reportCountMock.mock.restore();
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
  }
});

test('getAccountingTrialBalanceHandler validates date filters', async () => {
  const { getAccountingTrialBalanceHandler } = await import('../lambda/accounting/handlers.js');

  const invalidDate = await getAccountingTrialBalanceHandler(
    makeEvent({ queryStringParameters: { from: 'not-a-date' } }),
  );
  assert.equal(invalidDate.statusCode, 422);
  assert.match(String(parseBody(invalidDate).message), /Invalid from date/);

  const backwards = await getAccountingTrialBalanceHandler(
    makeEvent({ queryStringParameters: { from: '2026-06-01', to: '2026-05-01' } }),
  );
  assert.equal(backwards.statusCode, 422);
  assert.match(String(parseBody(backwards).message), /from must be before to/);
});

test('getAccountingClosePackageHandler assembles period evidence from live accounting records', async () => {
  const {
    getAccountingClosePackageHandler,
    accountingReportQueries,
    accountingClosePackageQueries,
    accountingPeriodLockQueries,
    accountingSyncContextQueries,
    operationalLedgerQueries,
  } = await import('../lambda/accounting/handlers.js');

  const workOrderId = '00000000-0000-4000-8000-000000000601';
  const customerId = '00000000-0000-4000-8000-000000000602';
  const journal = {
    id: '00000000-0000-4000-8000-000000000603',
    journalNumber: 'GJ-PAY-20260505-PAY1',
    sourceType: 'CUSTOMER_PAYMENT',
    sourceId: 'pay-1',
    sourceLedgerEntryId: 'payment-pay-1',
    sourceDocumentNumber: 'QB-PAY-1',
    counterparty: customerId,
    ledgerDate: new Date('2026-05-05T00:00:00.000Z'),
    currencyCode: 'USD',
    status: 'POSTED',
    totalDebitCents: 50000,
    totalCreditCents: 50000,
    memo: 'QuickBooks payment matched.',
    postedAt: new Date('2026-05-05T12:00:00.000Z'),
    postedBy: 'accounting-user',
    reversalOfJournalId: null,
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    correlationId: 'corr-journal',
    createdAt: new Date('2026-05-05T12:00:00.000Z'),
    version: 0,
    lines: [
      {
        id: '00000000-0000-4000-8000-000000000604',
        journalEntryId: '00000000-0000-4000-8000-000000000603',
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
        id: '00000000-0000-4000-8000-000000000605',
        journalEntryId: '00000000-0000-4000-8000-000000000603',
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

  const reportJournalsMock = mock.method(
    accountingReportQueries,
    'listPostedJournals',
    async () => [journal] as never,
  );
  const reportCountMock = mock.method(
    accountingReportQueries,
    'countPostedJournals',
    async () => 1,
  );
  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () => [],
  );
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () => [],
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () => [],
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 0,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 0,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 0,
  );
  const lockMock = mock.method(
    accountingPeriodLockQueries,
    'listOverlapping',
    async () =>
      [
        {
          id: '00000000-0000-4000-8000-000000000606',
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T23:59:59.999Z'),
          status: 'LOCKED',
          reason: 'May close reviewed.',
          lockedAt: new Date('2026-06-01T00:00:00.000Z'),
          lockedBy: 'accounting-user',
          correlationId: 'corr-lock',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          version: 0,
        },
      ] as never,
  );
  const invoiceDocsMock = mock.method(
    accountingClosePackageQueries,
    'listInvoiceDocuments',
    async () =>
      [
        {
          id: '00000000-0000-4000-8000-000000000707',
          invoiceSyncId: '00000000-0000-4000-8000-000000000607',
          workOrderId,
          customerId: null,
          provider: 'QUICKBOOKS',
          documentNumber: 'INV-1001',
          externalReference: 'QB-INV-1001',
          documentStatus: 'EXPORTED',
          documentDate: new Date('2026-05-05T12:00:00.000Z'),
          currencyCode: 'USD',
          amountCents: null,
          workOrderNumber: 'WO-1001',
          customerName: null,
          syncState: 'SYNCED',
          attemptCount: 1,
          errorCode: null,
          errorMessage: null,
          documentSummary: {},
          documentPayload: {},
          capturedAt: new Date('2026-05-05T12:00:00.000Z'),
          correlationId: 'corr-inv',
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
        },
      ] as never,
  );
  const invoiceCountMock = mock.method(
    accountingClosePackageQueries,
    'countInvoiceDocuments',
    async () => 1,
  );
  const paymentDocsMock = mock.method(
    accountingClosePackageQueries,
    'listPaymentDocuments',
    async () =>
      [
        {
          id: '00000000-0000-4000-8000-000000000708',
          paymentSyncId: '00000000-0000-4000-8000-000000000608',
          invoiceSyncId: '00000000-0000-4000-8000-000000000607',
          workOrderId,
          customerId,
          provider: 'QUICKBOOKS',
          documentNumber: 'QB-PAY-1001',
          externalReference: 'QB-PAY-1001',
          qbInvoiceId: 'QB-INV-1001',
          documentStatus: 'RECONCILED',
          documentDate: new Date('2026-05-06T00:00:00.000Z'),
          currencyCode: 'USD',
          amountCents: 50000,
          paymentMethod: 'Card',
          workOrderNumber: 'WO-1001',
          customerName: 'Customer One',
          syncState: 'RECONCILED',
          attemptCount: 1,
          errorMessage: null,
          documentSummary: {},
          documentPayload: {},
          capturedAt: new Date('2026-05-06T12:00:00.000Z'),
          correlationId: 'corr-pay',
          createdAt: new Date('2026-05-06T12:00:00.000Z'),
        },
      ] as never,
  );
  const paymentCountMock = mock.method(
    accountingClosePackageQueries,
    'countPaymentDocuments',
    async () => 1,
  );
  const workOrderMock = mock.method(accountingSyncContextQueries, 'findWorkOrders', async () => [
    {
      id: workOrderId,
      workOrderNumber: 'WO-1001',
      state: 'IN_PROGRESS',
      scheduledStartAt: new Date('2026-05-06T13:00:00.000Z'),
    },
  ]);
  const customerMock = mock.method(accountingSyncContextQueries, 'findCustomers', async () => [
    {
      id: customerId,
      displayName: 'Customer One',
      fullName: 'Customer One',
      companyName: null,
      email: 'customer@example.com',
      phone: null,
      state: 'ACTIVE',
    },
  ]);

  try {
    const response = await getAccountingClosePackageHandler(
      makeEvent({ queryStringParameters: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    assert.equal(body.packageNumber, 'CLOSE-20260501-20260531');
    assert.equal(body.closeStatus, 'READY');
    assert.equal(body.readyForExternalReview, true);
    assert.equal((body.summary as Record<string, unknown>).blockerCount, 0);
    assert.equal((body.summary as Record<string, unknown>).invoiceDocumentCount, 1);
    assert.equal((body.summary as Record<string, unknown>).paymentDocumentCount, 1);
    assert.equal((body.periodLock as Record<string, unknown>).status, 'LOCKED');
    assert.equal(
      ((body.documents as Record<string, unknown>).invoices as Array<Record<string, unknown>>)[0]
        ?.documentStatus,
      'EXPORTED',
    );
    assert.equal(
      ((body.documents as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0]
        ?.documentStatus,
      'RECONCILED',
    );
  } finally {
    reportJournalsMock.mock.restore();
    reportCountMock.mock.restore();
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
    lockMock.mock.restore();
    invoiceDocsMock.mock.restore();
    invoiceCountMock.mock.restore();
    paymentDocsMock.mock.restore();
    paymentCountMock.mock.restore();
    workOrderMock.mock.restore();
    customerMock.mock.restore();
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
    accountingPeriodLockQueries,
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
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () => [],
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () => [],
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 0,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 0,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 0,
  );
  const findMock = mock.method(accountingJournalQueries, 'findBySource', async () => null);
  const periodLocksMock = mock.method(
    accountingPeriodLockQueries,
    'listOverlapping',
    async () => [],
  );
  const createMock = mock.method(
    accountingJournalQueries,
    'createFromOperationalEntry',
    async (entry: Parameters<typeof accountingJournalQueries.createFromOperationalEntry>[0]) =>
      ({
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
    assert.equal(
      (body.posted as Array<Record<string, unknown>>)[0]?.sourceLedgerEntryId,
      'payable-po-1',
    );
    assert.equal((body.skipped as Record<string, unknown>).existing, 0);
    assert.equal((body.skipped as Record<string, unknown>).lockedPeriod, 0);
  } finally {
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
    findMock.mock.restore();
    periodLocksMock.mock.restore();
    createMock.mock.restore();
  }
});

test('postOperationalLedgerJournalsHandler posts warranty reimbursement entries', async () => {
  const {
    postOperationalLedgerJournalsHandler,
    operationalLedgerQueries,
    accountingJournalQueries,
    accountingPeriodLockQueries,
  } = await import('../lambda/accounting/handlers.js');

  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () => [],
  );
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () => [],
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () =>
      [
        {
          id: 'claim-post-1',
          claimNumber: 'WCLM-20260602-POST',
          customerId: 'cust-1',
          dealerAccountId: 'dealer-1',
          dealerRelationshipId: null,
          cartVehicleId: null,
          workOrderId: 'wo-1',
          claimStatus: 'REIMBURSEMENT_PENDING',
          requestedAmountCents: 27500,
          approvedAmountCents: 25000,
          reimbursedAmountCents: null,
          externalReference: null,
          claimReason: 'Warranty service',
          ownerUserId: null,
          notes: null,
          submittedAt: new Date('2026-06-01T12:00:00.000Z'),
          approvedAt: new Date('2026-06-02T12:00:00.000Z'),
          reimbursedAt: null,
          closedAt: null,
          correlationId: 'corr-warranty-post',
          createdAt: new Date('2026-06-01T12:00:00.000Z'),
          updatedAt: new Date('2026-06-02T12:00:00.000Z'),
          version: 0,
          customer: {
            fullName: 'Customer One',
            companyName: null,
            email: 'customer@example.com',
          },
          dealerAccount: {
            id: 'dealer-1',
            customerId: 'dealer-customer-1',
            dealerCode: 'DLR',
            territory: 'Southeast',
            serviceRelationship: 'ACTIVE',
            accountOwner: null,
            notes: null,
            createdAt: new Date('2026-05-01T12:00:00.000Z'),
            updatedAt: new Date('2026-05-01T12:00:00.000Z'),
            archivedAt: null,
            version: 0,
            customer: {
              fullName: 'Dealer One',
              companyName: 'Dealer One LLC',
              email: 'dealer@example.com',
            },
          },
          dealerRelationship: null,
          cartVehicle: null,
          workOrder: {
            workOrderNumber: 'WO-1001',
            status: 'IN_PROGRESS',
            dueAt: null,
          },
        },
      ] as unknown as Awaited<ReturnType<typeof operationalLedgerQueries.listWarrantyClaims>>,
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 0,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 0,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 0,
  );
  const findMock = mock.method(accountingJournalQueries, 'findBySource', async () => null);
  const periodLocksMock = mock.method(
    accountingPeriodLockQueries,
    'listOverlapping',
    async () => [],
  );
  const createMock = mock.method(
    accountingJournalQueries,
    'createFromOperationalEntry',
    async (entry: Parameters<typeof accountingJournalQueries.createFromOperationalEntry>[0]) =>
      ({
        id: '00000000-0000-4000-8000-000000000901',
        journalNumber: 'GJ-WR-20260602-CLAIMPOST1',
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
        postedAt: new Date('2026-06-02T12:00:00.000Z'),
        postedBy: 'system',
        correlationId: 'corr-post',
        createdAt: new Date('2026-06-02T12:00:00.000Z'),
        version: 0,
        lines: [
          {
            id: '00000000-0000-4000-8000-000000000902',
            journalEntryId: '00000000-0000-4000-8000-000000000901',
            lineNumber: 1,
            accountName: entry.accountDebit,
            accountCode: 'WARRANTY_REIMBURSEMENT_RECEIVABLE',
            debitCents: entry.debitCents,
            creditCents: 0,
            memo: entry.memo,
            dimensionType: entry.relatedRecordType,
            dimensionId: entry.relatedRecordId,
            createdAt: new Date('2026-06-02T12:00:00.000Z'),
          },
          {
            id: '00000000-0000-4000-8000-000000000903',
            journalEntryId: '00000000-0000-4000-8000-000000000901',
            lineNumber: 2,
            accountName: entry.accountCredit,
            accountCode: 'WARRANTY_REIMBURSEMENT_INCOME',
            debitCents: 0,
            creditCents: entry.creditCents,
            memo: entry.memo,
            dimensionType: entry.relatedRecordType,
            dimensionId: entry.relatedRecordId,
            createdAt: new Date('2026-06-02T12:00:00.000Z'),
          },
        ],
      }) as never,
  );

  try {
    const response = await postOperationalLedgerJournalsHandler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ confirm: true, sourceType: 'WARRANTY_REIMBURSEMENT' }),
      }),
    );
    assert.equal(response.statusCode, 201);
    const body = parseBody(response);
    assert.equal(body.postedCount, 1);
    const posted = (body.posted as Array<Record<string, unknown>>)[0];
    assert.equal(posted?.sourceType, 'WARRANTY_REIMBURSEMENT');
    assert.equal(posted?.sourceLedgerEntryId, 'warranty-claim-post-1');
    assert.equal(posted?.totalDebitCents, 25000);
  } finally {
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
    findMock.mock.restore();
    periodLocksMock.mock.restore();
    createMock.mock.restore();
  }
});

test('lockAccountingPeriodHandler creates a lock when close readiness is clear', async () => {
  const {
    lockAccountingPeriodHandler,
    accountingPeriodLockQueries,
    accountingReportQueries,
    operationalLedgerQueries,
  } = await import('../lambda/accounting/handlers.js');

  const overlapMock = mock.method(accountingPeriodLockQueries, 'listOverlapping', async () => []);
  const reportJournalsMock = mock.method(
    accountingReportQueries,
    'listPostedJournals',
    async () => [],
  );
  const reportCountMock = mock.method(
    accountingReportQueries,
    'countPostedJournals',
    async () => 0,
  );
  const listPayablesMock = mock.method(
    operationalLedgerQueries,
    'listPayablePurchaseOrders',
    async () => [],
  );
  const listPaymentsMock = mock.method(
    operationalLedgerQueries,
    'listPaymentSyncRecords',
    async () => [],
  );
  const listReconciliationMock = mock.method(
    operationalLedgerQueries,
    'listReconciliationRecords',
    async () => [],
  );
  const listWarrantyClaimsMock = mock.method(
    operationalLedgerQueries,
    'listWarrantyClaims',
    async () => [],
  );
  const invoiceFailuresMock = mock.method(
    operationalLedgerQueries,
    'countInvoiceFailures',
    async () => 0,
  );
  const customerFailuresMock = mock.method(
    operationalLedgerQueries,
    'countCustomerFailures',
    async () => 0,
  );
  const paymentFailuresMock = mock.method(
    operationalLedgerQueries,
    'countPaymentFailures',
    async () => 0,
  );
  const mismatchMock = mock.method(
    operationalLedgerQueries,
    'countReconciliationMismatches',
    async () => 0,
  );
  const createMock = mock.method(
    accountingPeriodLockQueries,
    'create',
    async (params: Parameters<typeof accountingPeriodLockQueries.create>[0]) =>
      ({
        id: '00000000-0000-4000-8000-000000000401',
        periodStart: params.from,
        periodEnd: params.to,
        status: 'LOCKED',
        reason: params.reason,
        lockedAt: new Date('2026-05-31T23:59:59.000Z'),
        lockedBy: params.actorId,
        correlationId: params.correlationId,
        createdAt: new Date('2026-05-31T23:59:59.000Z'),
        version: 0,
      }) as never,
  );

  try {
    const response = await lockAccountingPeriodHandler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          confirm: true,
          from: '2026-05-01',
          to: '2026-05-31',
          reason: 'May close reviewed.',
        }),
      }),
    );

    assert.equal(response.statusCode, 201);
    const body = parseBody(response);
    assert.equal(body.closeStatus, 'READY');
    assert.equal((body.lock as Record<string, unknown>).status, 'LOCKED');
  } finally {
    overlapMock.mock.restore();
    reportJournalsMock.mock.restore();
    reportCountMock.mock.restore();
    listPayablesMock.mock.restore();
    listPaymentsMock.mock.restore();
    listReconciliationMock.mock.restore();
    listWarrantyClaimsMock.mock.restore();
    invoiceFailuresMock.mock.restore();
    customerFailuresMock.mock.restore();
    paymentFailuresMock.mock.restore();
    mismatchMock.mock.restore();
    createMock.mock.restore();
  }
});

test('reverseAccountingJournalHandler creates a reversing journal when period is open', async () => {
  const { reverseAccountingJournalHandler, accountingJournalQueries, accountingPeriodLockQueries } =
    await import('../lambda/accounting/handlers.js');

  const original = {
    id: '00000000-0000-4000-8000-000000000501',
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
    reversalOfJournalId: null,
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    correlationId: 'corr-journal',
    createdAt: new Date('2026-05-05T12:00:00.000Z'),
    version: 0,
    lines: [
      {
        id: '00000000-0000-4000-8000-000000000502',
        journalEntryId: '00000000-0000-4000-8000-000000000501',
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
        id: '00000000-0000-4000-8000-000000000503',
        journalEntryId: '00000000-0000-4000-8000-000000000501',
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
  const reversedOriginal = {
    ...original,
    status: 'REVERSED',
    reversedAt: new Date('2026-05-10T12:00:00.000Z'),
    reversedBy: 'system',
    reversalReason: 'Duplicate payment.',
  };
  const reversal = {
    ...original,
    id: '00000000-0000-4000-8000-000000000504',
    journalNumber: 'REV-GJ-PAY-20260505-PAY1',
    sourceId: `reversal:${original.id}`,
    sourceLedgerEntryId: `reversal-${original.id}`,
    sourceDocumentNumber: `REV-${original.journalNumber}`,
    reversalOfJournalId: original.id,
    reversalReason: 'Duplicate payment.',
    lines: original.lines.map((line) => ({
      ...line,
      id: `${line.id.slice(0, -1)}9`,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
    })),
  };

  const findMock = mock.method(accountingJournalQueries, 'findById', async () => original as never);
  const periodLocksMock = mock.method(
    accountingPeriodLockQueries,
    'listOverlapping',
    async () => [],
  );
  const reverseMock = mock.method(
    accountingJournalQueries,
    'reverseJournal',
    async () =>
      ({
        original: reversedOriginal,
        reversal,
      }) as never,
  );

  try {
    const response = await reverseAccountingJournalHandler(
      makeEvent({
        httpMethod: 'POST',
        pathParameters: { journalId: original.id },
        body: JSON.stringify({ confirm: true, reason: 'Duplicate payment.' }),
      }),
    );

    assert.equal(response.statusCode, 201);
    const body = parseBody(response);
    assert.equal((body.original as Record<string, unknown>).status, 'REVERSED');
    assert.equal((body.reversal as Record<string, unknown>).reversalOfJournalId, original.id);
  } finally {
    findMock.mock.restore();
    periodLocksMock.mock.restore();
    reverseMock.mock.restore();
  }
});

test('reverseAccountingJournalHandler rejects journals in locked periods', async () => {
  const { reverseAccountingJournalHandler, accountingJournalQueries, accountingPeriodLockQueries } =
    await import('../lambda/accounting/handlers.js');

  const original = {
    id: '00000000-0000-4000-8000-000000000601',
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
    reversalOfJournalId: null,
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    correlationId: 'corr-journal',
    createdAt: new Date('2026-05-05T12:00:00.000Z'),
    version: 0,
    lines: [],
  };
  const findMock = mock.method(accountingJournalQueries, 'findById', async () => original as never);
  const periodLocksMock = mock.method(
    accountingPeriodLockQueries,
    'listOverlapping',
    async () =>
      [
        {
          id: '00000000-0000-4000-8000-000000000602',
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T23:59:59.999Z'),
          status: 'LOCKED',
          reason: 'May close.',
          lockedAt: new Date('2026-06-01T00:00:00.000Z'),
          lockedBy: 'system',
          correlationId: 'corr-lock',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          version: 0,
        },
      ] as never,
  );

  try {
    const response = await reverseAccountingJournalHandler(
      makeEvent({
        httpMethod: 'POST',
        pathParameters: { journalId: original.id },
        body: JSON.stringify({ confirm: true, reason: 'Duplicate payment.' }),
      }),
    );

    assert.equal(response.statusCode, 409);
    assert.match(String(parseBody(response).message), /locked period/);
  } finally {
    findMock.mock.restore();
    periodLocksMock.mock.restore();
  }
});
