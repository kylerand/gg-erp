import { Prisma, PrismaClient } from '@prisma/client';
import type { IntegrationAccountStatus, IntegrationProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse, type LambdaResult } from '../../shared/lambda/index.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  QuickBooksClient,
  type QbTokens,
} from '../../contexts/accounting/quickbooks.client.js';
import { createTokenManager } from '../../contexts/accounting/quickbooks.tokenManager.js';
import * as integrationAccountService from '../../contexts/accounting/integrationAccount.service.js';
import {
  InvoiceSyncService,
  invoiceSyncQueries,
  type InvoiceSyncServiceDeps,
} from '../../contexts/accounting/invoiceSync.service.js';
import {
  CustomerSyncService,
  customerSyncQueries,
  type CustomerSyncServiceDeps,
} from '../../contexts/accounting/customerSync.service.js';
import {
  PaymentSyncService,
  paymentSyncQueries,
  prismaPaymentSyncResolvers,
  type PaymentSyncServiceDeps,
} from '../../contexts/accounting/paymentSync.service.js';
import {
  ReconciliationService,
  reconciliationQueries,
  reconciliationSyncQueries,
  type ReconciliationServiceDeps,
} from '../../contexts/accounting/reconciliation.service.js';
import {
  FailureQueueService,
  failureQueueQueries,
  type SyncRecordType,
} from '../../contexts/accounting/failureQueue.service.js';
import {
  MappingService,
  mappingQueries,
  DimensionMappingType,
  type UpsertDimensionInput,
  type UpsertTaxInput,
} from '../../contexts/accounting/mapping.service.js';
import { InMemoryAuditSink } from '../../audit/recorder.js';
import {
  InMemoryEventPublisher,
  InMemoryOutbox,
} from '../../events/index.js';
import { ConsoleObservabilityHooks } from '../../observability/index.js';
import { EntityMappingService } from '../../contexts/accounting/entityMapping.service.js';
import { InvoiceSyncState } from '../../../../../packages/domain/src/model/index.js';
import { CustomerSyncState } from '../../../../../packages/domain/src/model/index.js';
import { PaymentSyncState } from '../../../../../packages/domain/src/model/index.js';

const prisma = new PrismaClient();
const tokenManager = createTokenManager();

const ACCOUNTING_LEDGER_PURCHASE_ORDER_INCLUDE = Prisma.validator<Prisma.PurchaseOrderInclude>()({
  vendor: { select: { vendorName: true, vendorCode: true } },
  lines: {
    include: {
      part: { select: { sku: true, name: true } },
    },
    orderBy: { lineNumber: 'asc' },
  },
});

type LedgerPurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  include: typeof ACCOUNTING_LEDGER_PURCHASE_ORDER_INCLUDE;
}>;
type LedgerPaymentSyncRecord = Awaited<
  ReturnType<typeof prisma.paymentSyncRecord.findMany>
>[number];
type LedgerReconciliationRecord = Awaited<
  ReturnType<typeof prisma.reconciliationRecord.findMany>
>[number];
type AccountingJournalWithLines = Prisma.AccountingJournalEntryGetPayload<{
  include: { lines: true };
}>;

type OperationalLedgerSourceType =
  | 'PAYABLE_RECEIPT'
  | 'CUSTOMER_PAYMENT'
  | 'RECONCILIATION_VARIANCE';
type OperationalLedgerStatus =
  | 'READY_FOR_REVIEW'
  | 'NEEDS_REVIEW'
  | 'POSTED'
  | 'PENDING'
  | 'FAILED'
  | 'MISMATCH'
  | 'RESOLVED';

interface OperationalLedgerEntry {
  id: string;
  ledgerDate: string;
  sourceType: OperationalLedgerSourceType;
  sourceId: string;
  documentNumber: string;
  counterparty: string;
  accountDebit: string;
  accountCredit: string;
  debitCents: number;
  creditCents: number;
  amountCents: number;
  currency: 'USD';
  status: OperationalLedgerStatus;
  memo: string;
  relatedRecordType: 'purchase-order' | 'payment-sync' | 'reconciliation-record';
  relatedRecordId: string;
}

interface LedgerExceptionCounts {
  invoice: number;
  customer: number;
  payment: number;
  reconciliation: number;
}

interface OperationalLedgerPostingRule {
  sourceType: OperationalLedgerSourceType;
  trigger: string;
  debitAccount: string;
  creditAccount: string;
  status: 'active-preview';
}

type AccountingJournalStatus = 'POSTED' | 'REVERSED';

interface AccountingJournalLineResponse {
  id: string;
  lineNumber: number;
  accountName: string;
  accountCode: string | null;
  debitCents: number;
  creditCents: number;
  memo: string | null;
  dimensionType: string | null;
  dimensionId: string | null;
}

interface AccountingJournalResponse {
  id: string;
  journalNumber: string;
  sourceType: OperationalLedgerSourceType;
  sourceId: string;
  sourceLedgerEntryId: string;
  sourceDocumentNumber: string;
  counterparty: string | null;
  ledgerDate: string;
  currencyCode: 'USD';
  status: AccountingJournalStatus;
  totalDebitCents: number;
  totalCreditCents: number;
  memo: string | null;
  postedAt: string;
  postedBy: string | null;
  correlationId: string | null;
  lines: AccountingJournalLineResponse[];
}

interface JournalPostRequest {
  confirm?: boolean;
  sourceType?: OperationalLedgerSourceType;
  limit?: number;
}

const OPERATIONAL_LEDGER_SOURCE_TYPES = new Set<OperationalLedgerSourceType>([
  'PAYABLE_RECEIPT',
  'CUSTOMER_PAYMENT',
  'RECONCILIATION_VARIANCE',
]);
const OPERATIONAL_LEDGER_STATUSES = new Set<OperationalLedgerStatus>([
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
  'POSTED',
  'PENDING',
  'FAILED',
  'MISMATCH',
  'RESOLVED',
]);
const PAYABLE_LEDGER_STATES = ['PARTIALLY_RECEIVED', 'RECEIVED'] as const;
const ACCOUNTING_JOURNAL_STATUSES = new Set<AccountingJournalStatus>(['POSTED', 'REVERSED']);
const JOURNAL_POSTABLE_STATUSES = new Set<OperationalLedgerStatus>([
  'READY_FOR_REVIEW',
  'POSTED',
]);

const OPERATIONAL_LEDGER_POSTING_RULES: OperationalLedgerPostingRule[] = [
  {
    sourceType: 'PAYABLE_RECEIPT',
    trigger: 'Purchase order lines are received into inventory.',
    debitAccount: 'Inventory received not billed',
    creditAccount: 'Accounts payable - unbilled',
    status: 'active-preview',
  },
  {
    sourceType: 'CUSTOMER_PAYMENT',
    trigger: 'QuickBooks payment webhook is matched to an ERP work order.',
    debitAccount: 'Undeposited funds / bank clearing',
    creditAccount: 'Accounts receivable',
    status: 'active-preview',
  },
  {
    sourceType: 'RECONCILIATION_VARIANCE',
    trigger: 'ERP and QuickBooks reconciliation detects an amount mismatch.',
    debitAccount: 'Reconciliation clearing',
    creditAccount: 'Suspense / review clearing',
    status: 'active-preview',
  },
];

export const operationalLedgerQueries = {
  async listPayablePurchaseOrders(take: number): Promise<LedgerPurchaseOrder[]> {
    return prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { purchaseOrderState: { in: [...PAYABLE_LEDGER_STATES] } },
          { lines: { some: { receivedQuantity: { gt: 0 } } } },
          { lines: { some: { rejectedQuantity: { gt: 0 } } } },
        ],
      },
      include: ACCOUNTING_LEDGER_PURCHASE_ORDER_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { orderedAt: 'desc' }],
      take,
    });
  },

  async listPaymentSyncRecords(take: number): Promise<LedgerPaymentSyncRecord[]> {
    return prisma.paymentSyncRecord.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  },

  async listReconciliationRecords(take: number): Promise<LedgerReconciliationRecord[]> {
    return prisma.reconciliationRecord.findMany({
      where: { status: { in: ['MISMATCH', 'RESOLVED'] } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  },

  async countInvoiceFailures(): Promise<number> {
    return prisma.invoiceSyncRecord.count({ where: { state: 'FAILED' } });
  },

  async countCustomerFailures(): Promise<number> {
    return prisma.customerSyncRecord.count({ where: { state: 'FAILED' } });
  },

  async countPaymentFailures(): Promise<number> {
    return prisma.paymentSyncRecord.count({ where: { state: 'FAILED' } });
  },

  async countReconciliationMismatches(): Promise<number> {
    return prisma.reconciliationRecord.count({ where: { status: 'MISMATCH' } });
  },
};

function parseLedgerLimit(value: string | undefined): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(Math.floor(parsed), 200);
}

function parseLedgerOffset(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function numberFromDecimal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

function centsFromDecimal(value: number): number {
  return Math.round(value * 100);
}

function payableOpenQuantity(line: LedgerPurchaseOrder['lines'][number]): number {
  return Math.max(
    numberFromDecimal(line.orderedQuantity) -
      numberFromDecimal(line.receivedQuantity) -
      numberFromDecimal(line.rejectedQuantity),
    0,
  );
}

function buildPayableLedgerEntry(po: LedgerPurchaseOrder): OperationalLedgerEntry | undefined {
  const receivedQuantity = po.lines.reduce(
    (sum, line) => sum + numberFromDecimal(line.receivedQuantity),
    0,
  );
  const rejectedQuantity = po.lines.reduce(
    (sum, line) => sum + numberFromDecimal(line.rejectedQuantity),
    0,
  );
  const openQuantity = po.lines.reduce((sum, line) => sum + payableOpenQuantity(line), 0);
  const receivedValue = po.lines.reduce(
    (sum, line) =>
      sum + numberFromDecimal(line.receivedQuantity) * numberFromDecimal(line.unitCost),
    0,
  );

  if (receivedQuantity === 0 && rejectedQuantity === 0) return undefined;

  const amountCents = centsFromDecimal(receivedValue);
  const partSummary = po.lines
    .filter((line) => numberFromDecimal(line.receivedQuantity) > 0)
    .slice(0, 3)
    .map((line) => line.part?.sku ?? line.part?.name ?? `line ${line.lineNumber}`)
    .join(', ');

  return {
    id: `payable-${po.id}`,
    ledgerDate: po.closedAt?.toISOString() ?? po.updatedAt.toISOString(),
    sourceType: 'PAYABLE_RECEIPT',
    sourceId: po.id,
    documentNumber: po.poNumber,
    counterparty: po.vendor.vendorName || po.vendor.vendorCode,
    accountDebit: 'Inventory received not billed',
    accountCredit: 'Accounts payable - unbilled',
    debitCents: amountCents,
    creditCents: amountCents,
    amountCents,
    currency: 'USD',
    status: openQuantity > 0 || rejectedQuantity > 0 ? 'NEEDS_REVIEW' : 'READY_FOR_REVIEW',
    memo:
      partSummary.length > 0
        ? `${receivedQuantity} received from ${po.vendor.vendorName}: ${partSummary}`
        : `${receivedQuantity} received from ${po.vendor.vendorName}`,
    relatedRecordType: 'purchase-order',
    relatedRecordId: po.id,
  };
}

function paymentLedgerStatus(state: string): OperationalLedgerStatus {
  if (state === 'SYNCED' || state === 'RECONCILED') return 'POSTED';
  if (state === 'FAILED') return 'FAILED';
  if (state === 'MISMATCH') return 'MISMATCH';
  return 'PENDING';
}

function buildPaymentLedgerEntry(record: LedgerPaymentSyncRecord): OperationalLedgerEntry {
  const amountCents = record.amountCents;
  return {
    id: `payment-${record.id}`,
    ledgerDate:
      record.paymentDate?.toISOString() ??
      record.lastAttemptAt?.toISOString() ??
      record.updatedAt.toISOString(),
    sourceType: 'CUSTOMER_PAYMENT',
    sourceId: record.id,
    documentNumber: record.qbPaymentId ?? record.qbInvoiceId ?? record.id,
    counterparty: record.customerId,
    accountDebit: 'Undeposited funds / bank clearing',
    accountCredit: 'Accounts receivable',
    debitCents: amountCents,
    creditCents: amountCents,
    amountCents,
    currency: 'USD',
    status: paymentLedgerStatus(String(record.state)),
    memo: record.errorMessage
      ? `QuickBooks payment review: ${record.errorMessage}`
      : `QuickBooks payment matched to work order ${record.workOrderId}`,
    relatedRecordType: 'payment-sync',
    relatedRecordId: record.id,
  };
}

function reconciliationAmountCents(record: LedgerReconciliationRecord): number {
  if (record.erpAmountCents != null && record.qbAmountCents != null) {
    return Math.abs(record.erpAmountCents - record.qbAmountCents);
  }
  return Math.max(Math.abs(record.erpAmountCents ?? 0), Math.abs(record.qbAmountCents ?? 0));
}

function buildReconciliationLedgerEntry(
  record: LedgerReconciliationRecord,
): OperationalLedgerEntry {
  const amountCents = reconciliationAmountCents(record);
  return {
    id: `reconciliation-${record.id}`,
    ledgerDate: record.updatedAt.toISOString(),
    sourceType: 'RECONCILIATION_VARIANCE',
    sourceId: record.id,
    documentNumber: `${record.reconciliationType}:${record.erpRecordId}`,
    counterparty: record.qbRecordId ?? 'QuickBooks reconciliation',
    accountDebit: 'Reconciliation clearing',
    accountCredit: 'Suspense / review clearing',
    debitCents: amountCents,
    creditCents: amountCents,
    amountCents,
    currency: 'USD',
    status: record.status === 'RESOLVED' ? 'RESOLVED' : 'MISMATCH',
    memo: record.discrepancy ?? 'ERP and QuickBooks amounts require review.',
    relatedRecordType: 'reconciliation-record',
    relatedRecordId: record.id,
  };
}

function summarizeLedgerEntries(entries: OperationalLedgerEntry[], exceptions: LedgerExceptionCounts) {
  const sourceTotals = Object.fromEntries(
    [...OPERATIONAL_LEDGER_SOURCE_TYPES].map((sourceType) => [
      sourceType,
      { count: 0, amountCents: 0 },
    ]),
  ) as Record<OperationalLedgerSourceType, { count: number; amountCents: number }>;
  const statusTotals = Object.fromEntries(
    [...OPERATIONAL_LEDGER_STATUSES].map((status) => [status, { count: 0, amountCents: 0 }]),
  ) as Record<OperationalLedgerStatus, { count: number; amountCents: number }>;

  for (const entry of entries) {
    sourceTotals[entry.sourceType].count += 1;
    sourceTotals[entry.sourceType].amountCents += entry.amountCents;
    statusTotals[entry.status].count += 1;
    statusTotals[entry.status].amountCents += entry.amountCents;
  }

  return {
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    totalDebitCents: entries.reduce((sum, entry) => sum + entry.debitCents, 0),
    totalCreditCents: entries.reduce((sum, entry) => sum + entry.creditCents, 0),
    sourceTotals,
    statusTotals,
    exceptions,
  };
}

async function loadOperationalLedgerSnapshot(take: number): Promise<{
  entries: OperationalLedgerEntry[];
  exceptions: LedgerExceptionCounts;
}> {
  const [
    payables,
    payments,
    reconciliationRecords,
    invoiceFailures,
    customerFailures,
    paymentFailures,
    reconciliationMismatches,
  ] = await Promise.all([
    operationalLedgerQueries.listPayablePurchaseOrders(take),
    operationalLedgerQueries.listPaymentSyncRecords(take),
    operationalLedgerQueries.listReconciliationRecords(take),
    operationalLedgerQueries.countInvoiceFailures(),
    operationalLedgerQueries.countCustomerFailures(),
    operationalLedgerQueries.countPaymentFailures(),
    operationalLedgerQueries.countReconciliationMismatches(),
  ]);

  const entries = [
    ...payables.map(buildPayableLedgerEntry).filter((entry): entry is OperationalLedgerEntry => !!entry),
    ...payments.map(buildPaymentLedgerEntry),
    ...reconciliationRecords.map(buildReconciliationLedgerEntry),
  ].sort((a, b) => Date.parse(b.ledgerDate) - Date.parse(a.ledgerDate));

  return {
    entries,
    exceptions: {
      invoice: invoiceFailures,
      customer: customerFailures,
      payment: paymentFailures,
      reconciliation: reconciliationMismatches,
    },
  };
}

function parseJournalLimit(value: string | number | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), 200);
}

function parseJournalOffset(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function accountCodeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function journalNumberForLedgerEntry(entry: OperationalLedgerEntry): string {
  const sourcePrefix: Record<OperationalLedgerSourceType, string> = {
    PAYABLE_RECEIPT: 'AP',
    CUSTOMER_PAYMENT: 'PAY',
    RECONCILIATION_VARIANCE: 'REC',
  };
  const ledgerDate = entry.ledgerDate.slice(0, 10).replace(/-/g, '');
  const sourceSuffix = entry.sourceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
  return `GJ-${sourcePrefix[entry.sourceType]}-${ledgerDate}-${sourceSuffix}`;
}

function isPostableOperationalEntry(entry: OperationalLedgerEntry): boolean {
  return (
    JOURNAL_POSTABLE_STATUSES.has(entry.status) &&
    entry.debitCents === entry.creditCents &&
    entry.debitCents > 0
  );
}

function mapJournal(entry: AccountingJournalWithLines): AccountingJournalResponse {
  return {
    id: entry.id,
    journalNumber: entry.journalNumber,
    sourceType: entry.sourceType as OperationalLedgerSourceType,
    sourceId: entry.sourceId,
    sourceLedgerEntryId: entry.sourceLedgerEntryId,
    sourceDocumentNumber: entry.sourceDocumentNumber,
    counterparty: entry.counterparty,
    ledgerDate: entry.ledgerDate.toISOString(),
    currencyCode: 'USD',
    status: entry.status as AccountingJournalStatus,
    totalDebitCents: entry.totalDebitCents,
    totalCreditCents: entry.totalCreditCents,
    memo: entry.memo,
    postedAt: entry.postedAt.toISOString(),
    postedBy: entry.postedBy,
    correlationId: entry.correlationId,
    lines: entry.lines
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        accountName: line.accountName,
        accountCode: line.accountCode,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        memo: line.memo,
        dimensionType: line.dimensionType,
        dimensionId: line.dimensionId,
      })),
  };
}

function summarizeJournals(entries: AccountingJournalResponse[]) {
  const sourceTotals = Object.fromEntries(
    [...OPERATIONAL_LEDGER_SOURCE_TYPES].map((sourceType) => [
      sourceType,
      { count: 0, amountCents: 0 },
    ]),
  ) as Record<OperationalLedgerSourceType, { count: number; amountCents: number }>;

  for (const entry of entries) {
    sourceTotals[entry.sourceType].count += 1;
    sourceTotals[entry.sourceType].amountCents += entry.totalDebitCents;
  }

  return {
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    totalDebitCents: entries.reduce((sum, entry) => sum + entry.totalDebitCents, 0),
    totalCreditCents: entries.reduce((sum, entry) => sum + entry.totalCreditCents, 0),
    sourceTotals,
  };
}

export const accountingJournalQueries = {
  async list(params: {
    take: number;
    skip: number;
    sourceType?: OperationalLedgerSourceType;
    status?: AccountingJournalStatus;
  }): Promise<AccountingJournalWithLines[]> {
    return prisma.accountingJournalEntry.findMany({
      where: {
        ...(params.sourceType ? { sourceType: params.sourceType } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      include: { lines: true },
      orderBy: [{ ledgerDate: 'desc' }, { postedAt: 'desc' }],
      take: params.take,
      skip: params.skip,
    });
  },
  async count(params: {
    sourceType?: OperationalLedgerSourceType;
    status?: AccountingJournalStatus;
  }): Promise<number> {
    return prisma.accountingJournalEntry.count({
      where: {
        ...(params.sourceType ? { sourceType: params.sourceType } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
    });
  },
  async findBySource(entry: OperationalLedgerEntry): Promise<AccountingJournalWithLines | null> {
    return prisma.accountingJournalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: entry.sourceType, sourceId: entry.sourceId } },
      include: { lines: true },
    });
  },
  async createFromOperationalEntry(
    entry: OperationalLedgerEntry,
    context: { actorId: string; correlationId: string },
  ): Promise<AccountingJournalWithLines> {
    const existing = await this.findBySource(entry);
    if (existing) return existing;

    return prisma.accountingJournalEntry.create({
      data: {
        journalNumber: journalNumberForLedgerEntry(entry),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceLedgerEntryId: entry.id,
        sourceDocumentNumber: entry.documentNumber,
        counterparty: entry.counterparty,
        ledgerDate: new Date(entry.ledgerDate),
        currencyCode: entry.currency,
        status: 'POSTED',
        totalDebitCents: entry.debitCents,
        totalCreditCents: entry.creditCents,
        memo: entry.memo,
        postedBy: context.actorId,
        correlationId: context.correlationId,
        lines: {
          create: [
            {
              lineNumber: 1,
              accountName: entry.accountDebit,
              accountCode: accountCodeFromName(entry.accountDebit),
              debitCents: entry.debitCents,
              creditCents: 0,
              memo: entry.memo,
              dimensionType: entry.relatedRecordType,
              dimensionId: entry.relatedRecordId,
            },
            {
              lineNumber: 2,
              accountName: entry.accountCredit,
              accountCode: accountCodeFromName(entry.accountCredit),
              debitCents: 0,
              creditCents: entry.creditCents,
              memo: entry.memo,
              dimensionType: entry.relatedRecordType,
              dimensionId: entry.relatedRecordId,
            },
          ],
        },
      },
      include: { lines: true },
    });
  },
};

// ─── OAuth: redirect to QB ────────────────────────────────────────────────────

export const oauthConnectHandler = wrapHandler(async (_ctx) => {
  const state = randomUUID();
  const url = buildAuthorizationUrl(state);
  return {
    statusCode: 302,
    headers: { Location: url, 'Set-Cookie': `qb_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/` },
    body: '',
  };
}, { requireAuth: false });

// ─── OAuth: callback from QB ──────────────────────────────────────────────────

/** Core callback logic — extracted for testability. */
export async function processOAuthCallback(
  params: { code: string; realmId: string; frontendUrl?: string },
  deps: {
    exchangeCode: (code: string, realmId: string) => Promise<QbTokens>;
    storeTokens: (tokens: QbTokens) => Promise<void>;
    upsertIntegrationAccount: (realmId: string) => Promise<void>;
  },
): Promise<LambdaResult> {
  let tokens: QbTokens;
  try {
    tokens = await deps.exchangeCode(params.code, params.realmId);
  } catch (err) {
    return jsonResponse(502, {
      message: err instanceof Error ? err.message : 'Token exchange failed',
    });
  }

  try {
    await deps.storeTokens(tokens);
    await deps.upsertIntegrationAccount(params.realmId);
  } catch (err) {
    return jsonResponse(500, {
      message: err instanceof Error ? err.message : 'Failed to persist QB connection.',
    });
  }

  const redirectUrl = params.frontendUrl
    ? `${params.frontendUrl}/accounting/sync?connected=true&realmId=${tokens.realmId}`
    : `/accounting/sync?connected=true&realmId=${tokens.realmId}`;

  return {
    statusCode: 302,
    headers: { Location: redirectUrl },
    body: JSON.stringify({
      message: 'QB connected.',
      realmId: tokens.realmId,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    }),
  };
}

async function upsertQbIntegrationAccount(db: PrismaClient, realmId: string): Promise<void> {
  const existing = await db.integrationAccount.findFirst({
    where: { provider: 'QUICKBOOKS', accountKey: realmId, deletedAt: null },
  });

  const now = new Date();
  const config = { realmId, connectedAt: now.toISOString() };

  if (existing) {
    await db.integrationAccount.update({
      where: { id: existing.id },
      data: { accountStatus: 'ACTIVE', configuration: config, updatedAt: now },
    });
  } else {
    await db.integrationAccount.create({
      data: {
        provider: 'QUICKBOOKS',
        accountKey: realmId,
        displayName: `QuickBooks (${realmId})`,
        accountStatus: 'ACTIVE',
        configuration: config,
      },
    });
  }
}

export const oauthCallbackHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const { code, realmId, error } = qs;

  if (error) {
    return jsonResponse(400, { message: `QB OAuth error: ${error}` });
  }
  if (!code || !realmId) {
    return jsonResponse(400, { message: 'Missing code or realmId from QB callback.' });
  }

  return processOAuthCallback(
    { code, realmId, frontendUrl: process.env.FRONTEND_URL },
    {
      exchangeCode: exchangeCodeForTokens,
      storeTokens: (tokens) => tokenManager.storeTokens(tokens),
      upsertIntegrationAccount: (realm) => upsertQbIntegrationAccount(prisma, realm),
    },
  );
}, { requireAuth: false });

// ─── Get QB connection status ─────────────────────────────────────────────────

/** Core status logic — extracted for testability. */
export async function processQbStatus(
  deps: {
    getValidTokens: () => Promise<QbTokens>;
    getCompanyInfo: (tokens: QbTokens) => Promise<{ companyName: string; realmId: string }>;
  },
): Promise<LambdaResult> {
  try {
    const tokens = await deps.getValidTokens();
    const info = await deps.getCompanyInfo(tokens);
    return jsonResponse(200, { connected: true, companyName: info.companyName, realmId: info.realmId });
  } catch (err) {
    return jsonResponse(200, {
      connected: false,
      message: err instanceof Error ? err.message : 'QB connection check failed',
    });
  }
}

export const qbStatusHandler = wrapHandler(async (_ctx) => {
  // Step 1: connection check (cheap; same response shape as before).
  const baseRes = await processQbStatus({
    getValidTokens: () => tokenManager.getValidTokens(),
    getCompanyInfo: (tokens) => new QuickBooksClient(tokens).getCompanyInfo(),
  });
  const baseBody = JSON.parse(baseRes.body) as {
    connected: boolean;
    companyName?: string;
    realmId?: string;
    message?: string;
  };

  if (!baseBody.connected) {
    return baseRes;
  }

  // Step 2: live QB read-side overview. Best-effort — any single failure is
  // surfaced as an empty field rather than failing the whole status response,
  // because the connection card itself should still render.
  let overview: {
    customerCount?: number;
    customers?: ReturnType<QuickBooksClient['listCustomers']> extends Promise<infer R> ? R : never;
    openInvoiceCount?: number;
    openInvoiceBalance?: number;
    recentInvoices?: ReturnType<QuickBooksClient['listRecentInvoices']> extends Promise<infer R> ? R : never;
    accounts?: ReturnType<QuickBooksClient['listAccounts']> extends Promise<infer R> ? R : never;
    accountsByType?: Record<string, number>;
    accountsTotal?: number;
    error?: string;
  } = {};
  try {
    const tokens = await tokenManager.getValidTokens();
    const qb = new QuickBooksClient(tokens);
    const [customerCount, customerList, recent, ar, accounts] = await Promise.allSettled([
      qb.countCustomers(),
      qb.listCustomers(200),
      qb.listRecentInvoices(5),
      qb.getOpenInvoicesSummary(),
      qb.listAccounts(),
    ]);
    if (customerCount.status === 'fulfilled') overview.customerCount = customerCount.value;
    if (customerList.status === 'fulfilled') {
      overview.customers = customerList.value;
      overview.customerCount ??= customerList.value.length;
    }
    if (recent.status === 'fulfilled') overview.recentInvoices = recent.value;
    if (ar.status === 'fulfilled') {
      overview.openInvoiceCount = ar.value.openCount;
      overview.openInvoiceBalance = ar.value.openBalance;
    }
    if (accounts.status === 'fulfilled') {
      overview.accounts = accounts.value;
      overview.accountsTotal = accounts.value.length;
      overview.accountsByType = {};
      for (const a of accounts.value) {
        overview.accountsByType[a.accountType] = (overview.accountsByType[a.accountType] ?? 0) + 1;
      }
    }
    // Surface the first underlying QB error so it shows on the page —
    // empty overview without an explanation is worse than showing the cause.
    const firstFailure = [customerCount, customerList, recent, ar, accounts].find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (firstFailure && Object.keys(overview).length === 0) {
      overview.error =
        firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : String(firstFailure.reason);
    }
  } catch (err) {
    overview = { error: err instanceof Error ? err.message : 'overview fetch failed' };
  }

  return jsonResponse(200, { ...baseBody, overview });
}, { requireAuth: false });

// ─── List invoice sync records ────────────────────────────────────────────────

export const listInvoiceSyncHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const state = qs.state;
  const workOrderId = qs.workOrderId;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(state ? { state: state as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED' } : {}),
    ...(workOrderId ? { workOrderId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.invoiceSyncRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.invoiceSyncRecord.count({ where }),
  ]);

  return jsonResponse(200, {
    items: items.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      workOrderId: r.workOrderId,
      provider: r.provider,
      state: r.state,
      attemptCount: r.attemptCount,
      lastErrorCode: r.lastErrorCode,
      lastErrorMessage: r.lastErrorMessage,
      externalReference: r.externalReference,
      createdAt: r.createdAt.toISOString(),
      syncedAt: r.syncedAt?.toISOString(),
    })),
    total,
    limit,
    offset,
  });
}, { requireAuth: false });

// ─── Retry a failed sync record ───────────────────────────────────────────────

export const retrySyncHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Sync record ID is required.' });

  const record = await prisma.invoiceSyncRecord.findUnique({ where: { id } });
  if (!record) return jsonResponse(404, { message: `Sync record not found: ${id}` });
  if (!['FAILED', 'CANCELLED'].includes(record.state)) {
    return jsonResponse(409, { message: `Cannot retry a record in ${record.state} state.` });
  }

  const updated = await prisma.invoiceSyncRecord.update({
    where: { id },
    data: {
      state: 'PENDING',
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    },
  });

  return jsonResponse(200, {
    id: updated.id,
    state: updated.state,
    message: 'Sync record queued for retry.',
  });
}, { requireAuth: false });

// ─── QB sync trigger (create invoice in QB) ───────────────────────────────────

interface TriggerSyncBody {
  workOrderId: string;
  invoiceNumber: string;
}

export const triggerSyncHandler = wrapHandler(async (ctx) => {
  const body = parseBody<TriggerSyncBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { workOrderId, invoiceNumber } = body.value;
  if (!workOrderId || !invoiceNumber) {
    return jsonResponse(422, { message: 'workOrderId and invoiceNumber are required.' });
  }

  const now = new Date();
  const record = await prisma.invoiceSyncRecord.create({
    data: {
      id: randomUUID(),
      invoiceNumber,
      workOrderId,
      provider: 'QUICKBOOKS',
      state: 'PENDING',
      attemptCount: 0,
      correlationId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    },
  });

  return jsonResponse(202, {
    id: record.id,
    state: record.state,
    message: 'Invoice sync queued.',
  });
}, { requireAuth: false });

// ─── List integration accounts ────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<string>(['QUICKBOOKS', 'SHOPMONKEY', 'GENERIC']);

export const listAccountsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const providerParam = qs.provider?.toUpperCase();

  if (providerParam && !VALID_PROVIDERS.has(providerParam)) {
    return jsonResponse(400, { message: `Invalid provider: ${qs.provider}` });
  }

  const provider = providerParam as IntegrationProvider | undefined;
  const accounts = await integrationAccountService.listAccounts(provider);

  return jsonResponse(200, {
    items: accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      accountKey: a.accountKey,
      displayName: a.displayName,
      accountStatus: a.accountStatus,
      configuration: a.configuration,
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    total: accounts.length,
  });
}, { requireAuth: false });

// ─── Update integration account status ────────────────────────────────────────

const VALID_STATUSES = new Set<string>(['ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED']);

interface UpdateStatusBody {
  status: string;
}

export const updateAccountStatusHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Account ID is required.' });

  const body = parseBody<UpdateStatusBody>(ctx.event);
  if (!body.ok) {
    return jsonResponse(400, { message: body.error });
  }

  const { status } = body.value;
  if (!status || !VALID_STATUSES.has(status)) {
    return jsonResponse(422, {
      message: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
    });
  }

  const updated = await integrationAccountService.updateAccountStatus(
    id,
    status as IntegrationAccountStatus,
  );

  if (!updated) {
    return jsonResponse(404, { message: `Integration account not found: ${id}` });
  }

  return jsonResponse(200, {
    id: updated.id,
    accountStatus: updated.accountStatus,
    updatedAt: updated.updatedAt.toISOString(),
  });
}, { requireAuth: false });

// ─── Service-backed invoice sync helpers ──────────────────────────────────────

function createInvoiceSyncService(): InvoiceSyncService {
  const deps: InvoiceSyncServiceDeps = {
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    queries: invoiceSyncQueries,
  };
  return new InvoiceSyncService(deps);
}

function createCustomerSyncService(): CustomerSyncService {
  const deps: CustomerSyncServiceDeps = {
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    entityMapping: new EntityMappingService({ prisma }),
    queries: customerSyncQueries,
  };
  return new CustomerSyncService(deps);
}

export function createPaymentSyncService(): PaymentSyncService {
  const deps: PaymentSyncServiceDeps = {
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    queries: paymentSyncQueries,
    resolvers: prismaPaymentSyncResolvers,
  };
  return new PaymentSyncService(deps);
}

const VALID_INVOICE_SYNC_STATES = new Set<string>(Object.values(InvoiceSyncState));
const VALID_CUSTOMER_SYNC_STATES = new Set<string>(Object.values(CustomerSyncState));
const VALID_PAYMENT_SYNC_STATES = new Set<string>(Object.values(PaymentSyncState));

// ─── Mockable list-query objects ──────────────────────────────────────────────

interface InvoiceSyncListItem {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: string;
  state: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  externalReference: string | null;
  createdAt: Date;
  syncedAt: Date | null;
}

interface InvoiceSyncWorkOrderSummary {
  id: string;
  workOrderNumber: string;
  state: string;
  scheduledStartAt: Date | null;
}

interface CustomerSyncListItem {
  id: string;
  customerId: string;
  provider: string;
  state: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  externalReference: string | null;
  createdAt: Date;
  syncedAt: Date | null;
}

interface CustomerSyncCustomerSummary {
  id: string;
  displayName: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  state: string;
}

interface PaymentSyncListItem {
  id: string;
  invoiceSyncId: string | null;
  workOrderId: string;
  customerId: string;
  qbPaymentId: string | null;
  qbInvoiceId: string | null;
  amountCents: number;
  paymentMethod: string | null;
  paymentDate: Date | null;
  state: string;
  direction: string;
  errorMessage: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const invoiceSyncListQueries = {
  async findMany(
    where: Record<string, string>,
    orderBy: Record<string, string>,
    take: number,
    skip: number,
  ): Promise<InvoiceSyncListItem[]> {
    return prisma.invoiceSyncRecord.findMany({ where, orderBy, take, skip });
  },
  async count(where: Record<string, string>): Promise<number> {
    return prisma.invoiceSyncRecord.count({ where });
  },
};

export const accountingSyncContextQueries = {
  async findWorkOrders(ids: string[]): Promise<InvoiceSyncWorkOrderSummary[]> {
    if (ids.length === 0) return [];
    const records = await prisma.workOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workOrderNumber: true,
        state: true,
        scheduledStartAt: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      workOrderNumber: record.workOrderNumber,
      state: String(record.state),
      scheduledStartAt: record.scheduledStartAt,
    }));
  },

  async findCustomers(ids: string[]): Promise<CustomerSyncCustomerSummary[]> {
    if (ids.length === 0) return [];
    const records = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fullName: true,
        companyName: true,
        email: true,
        phone: true,
        state: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      displayName: record.companyName?.trim() || record.fullName,
      fullName: record.fullName,
      companyName: record.companyName,
      email: record.email,
      phone: record.phone,
      state: String(record.state),
    }));
  },
};

export const customerSyncListQueries = {
  async findMany(
    where: Record<string, string>,
    orderBy: Record<string, string>,
    take: number,
    skip: number,
  ): Promise<CustomerSyncListItem[]> {
    return prisma.customerSyncRecord.findMany({ where, orderBy, take, skip });
  },
  async count(where: Record<string, string>): Promise<number> {
    return prisma.customerSyncRecord.count({ where });
  },
};

export const paymentSyncListQueries = {
  async findMany(
    where: Record<string, string>,
    orderBy: Record<string, string>,
    take: number,
    skip: number,
  ): Promise<PaymentSyncListItem[]> {
    return prisma.paymentSyncRecord.findMany({ where, orderBy, take, skip });
  },
  async count(where: Record<string, string>): Promise<number> {
    return prisma.paymentSyncRecord.count({ where });
  },
};

function compactSyncIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
}

async function loadInvoiceWorkOrderSummaries(
  workOrderIds: string[],
): Promise<Map<string, InvoiceSyncWorkOrderSummary>> {
  const workOrders = await accountingSyncContextQueries.findWorkOrders(
    compactSyncIds(workOrderIds),
  );
  return new Map(workOrders.map((workOrder) => [workOrder.id, workOrder]));
}

async function loadCustomerSyncSummaries(
  customerIds: string[],
): Promise<Map<string, CustomerSyncCustomerSummary>> {
  const customers = await accountingSyncContextQueries.findCustomers(compactSyncIds(customerIds));
  return new Map(customers.map((customer) => [customer.id, customer]));
}

// ─── List invoice syncs (service-backed) ──────────────────────────────────────

export const listInvoiceSyncsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const stateParam = qs.state;
  const workOrderId = qs.workOrderId;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  if (stateParam && !VALID_INVOICE_SYNC_STATES.has(stateParam)) {
    return jsonResponse(400, {
      message: `Invalid state filter. Must be one of: ${Array.from(VALID_INVOICE_SYNC_STATES).join(', ')}`,
    });
  }

  const where = {
    ...(stateParam
      ? { state: stateParam as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED' }
      : {}),
    ...(workOrderId ? { workOrderId } : {}),
  };

  const [items, total] = await Promise.all([
    invoiceSyncListQueries.findMany(where, { createdAt: 'desc' }, limit, offset),
    invoiceSyncListQueries.count(where),
  ]);
  const workOrdersById = await loadInvoiceWorkOrderSummaries(
    items.map((item) => item.workOrderId),
  );

  return jsonResponse(200, {
    items: items.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      workOrderId: r.workOrderId,
      workOrder: workOrdersById.get(r.workOrderId) ?? null,
      provider: r.provider,
      state: r.state,
      attemptCount: r.attemptCount,
      lastErrorCode: r.lastErrorCode,
      lastErrorMessage: r.lastErrorMessage,
      externalReference: r.externalReference,
      createdAt: r.createdAt.toISOString(),
      syncedAt: r.syncedAt?.toISOString() ?? null,
    })),
    total,
    limit,
    offset,
  });
}, { requireAuth: false });

// ─── Trigger invoice sync (service-backed) ────────────────────────────────────

interface TriggerInvoiceSyncBody {
  workOrderId: string;
  invoiceNumber: string;
}

export const triggerInvoiceSyncHandler = wrapHandler(async (ctx) => {
  const body = parseBody<TriggerInvoiceSyncBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { workOrderId, invoiceNumber } = body.value;
  if (!workOrderId || !invoiceNumber) {
    return jsonResponse(422, { message: 'workOrderId and invoiceNumber are required.' });
  }

  const service = createInvoiceSyncService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  try {
    const record = await service.createRecord(
      { invoiceNumber, workOrderId, provider: 'QUICKBOOKS' },
      context,
    );
    return jsonResponse(202, {
      id: record.id,
      state: record.state,
      message: 'Invoice sync queued.',
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return jsonResponse(409, { message: err.message });
    }
    throw err;
  }
}, { requireAuth: false });

// ─── Retry invoice sync (service-backed) ──────────────────────────────────────

export const retryInvoiceSyncHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Sync record ID is required.' });

  const service = createInvoiceSyncService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  const record = await service.getRecord(id);
  if (!record) return jsonResponse(404, { message: `Sync record not found: ${id}` });

  if (record.state !== InvoiceSyncState.FAILED && record.state !== InvoiceSyncState.CANCELLED) {
    return jsonResponse(409, { message: `Cannot retry a record in ${record.state} state.` });
  }

  const updated = await service.startSync(id, context);
  return jsonResponse(200, {
    id: updated.id,
    state: updated.state,
    message: 'Sync record queued for retry.',
  });
}, { requireAuth: false });

// ─── List customer syncs ──────────────────────────────────────────────────────

export const listCustomerSyncsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const stateParam = qs.state;
  const customerId = qs.customerId;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  if (stateParam && !VALID_CUSTOMER_SYNC_STATES.has(stateParam)) {
    return jsonResponse(400, {
      message: `Invalid state filter. Must be one of: ${Array.from(VALID_CUSTOMER_SYNC_STATES).join(', ')}`,
    });
  }

  const where = {
    ...(stateParam
      ? { state: stateParam as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'SKIPPED' }
      : {}),
    ...(customerId ? { customerId } : {}),
  };

  const [items, total] = await Promise.all([
    customerSyncListQueries.findMany(where, { createdAt: 'desc' }, limit, offset),
    customerSyncListQueries.count(where),
  ]);
  const customersById = await loadCustomerSyncSummaries(items.map((item) => item.customerId));

  return jsonResponse(200, {
    items: items.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customer: customersById.get(r.customerId) ?? null,
      provider: r.provider,
      state: r.state,
      attemptCount: r.attemptCount,
      lastErrorCode: r.lastErrorCode,
      lastErrorMessage: r.lastErrorMessage,
      externalReference: r.externalReference,
      createdAt: r.createdAt.toISOString(),
      syncedAt: r.syncedAt?.toISOString() ?? null,
    })),
    total,
    limit,
    offset,
  });
}, { requireAuth: false });

// ─── List payment syncs ──────────────────────────────────────────────────────

export const listPaymentSyncsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const stateParam = qs.state;
  const workOrderId = qs.workOrderId;
  const customerId = qs.customerId;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  if (stateParam && !VALID_PAYMENT_SYNC_STATES.has(stateParam)) {
    return jsonResponse(400, {
      message: `Invalid state filter. Must be one of: ${Array.from(VALID_PAYMENT_SYNC_STATES).join(', ')}`,
    });
  }

  const where = {
    ...(stateParam ? { state: stateParam } : {}),
    ...(workOrderId ? { workOrderId } : {}),
    ...(customerId ? { customerId } : {}),
  };

  const [items, total] = await Promise.all([
    paymentSyncListQueries.findMany(where, { updatedAt: 'desc' }, limit, offset),
    paymentSyncListQueries.count(where),
  ]);
  const [workOrdersById, customersById] = await Promise.all([
    loadInvoiceWorkOrderSummaries(items.map((item) => item.workOrderId)),
    loadCustomerSyncSummaries(items.map((item) => item.customerId)),
  ]);

  return jsonResponse(200, {
    items: items.map((r) => ({
      id: r.id,
      invoiceSyncId: r.invoiceSyncId,
      workOrderId: r.workOrderId,
      workOrder: workOrdersById.get(r.workOrderId) ?? null,
      customerId: r.customerId,
      customer: customersById.get(r.customerId) ?? null,
      qbPaymentId: r.qbPaymentId,
      qbInvoiceId: r.qbInvoiceId,
      amountCents: r.amountCents,
      paymentMethod: r.paymentMethod,
      paymentDate: r.paymentDate?.toISOString().split('T')[0] ?? null,
      state: r.state,
      direction: r.direction,
      errorMessage: r.errorMessage,
      attemptCount: r.attemptCount,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    limit,
    offset,
  });
}, { requireAuth: false });

// ─── Retry payment sync ──────────────────────────────────────────────────────

export const retryPaymentSyncHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Payment sync record ID is required.' });

  const service = createPaymentSyncService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  const record = await service.getRecord(id);
  if (!record) return jsonResponse(404, { message: `Payment sync record not found: ${id}` });
  if (record.state !== PaymentSyncState.FAILED) {
    return jsonResponse(409, {
      message: `Cannot retry a payment record in ${record.state} state.`,
    });
  }

  const updated = await service.retryPayment(id, context);
  return jsonResponse(200, {
    id: updated.id,
    state: updated.state,
    message: 'Payment sync queued for retry.',
  });
}, { requireAuth: false });

// ─── Trigger customer sync ───────────────────────────────────────────────────

interface TriggerCustomerSyncBody {
  customerId: string;
  displayName: string;
  email?: string;
  integrationAccountId: string;
}

export const triggerCustomerSyncHandler = wrapHandler(async (ctx) => {
  const body = parseBody<TriggerCustomerSyncBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { customerId, displayName, integrationAccountId } = body.value;
  if (!customerId || !displayName || !integrationAccountId) {
    return jsonResponse(422, {
      message: 'customerId, displayName, and integrationAccountId are required.',
    });
  }

  const service = createCustomerSyncService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  const record = await service.queueSync(
    {
      customerId,
      displayName,
      email: body.value.email,
      integrationAccountId,
    },
    context,
  );

  return jsonResponse(202, {
    id: record.id,
    state: record.state,
    message: 'Customer sync queued.',
  });
}, { requireAuth: false });

// ─── Reconciliation & Failure Queue service factories ─────────────────────────

function createReconciliationService(): ReconciliationService {
  const deps: ReconciliationServiceDeps = {
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
    queries: reconciliationQueries,
    syncQueries: reconciliationSyncQueries,
  };
  return new ReconciliationService(deps);
}

function createFailureQueueService(): FailureQueueService {
  return new FailureQueueService({ queries: failureQueueQueries });
}

const VALID_FAILURE_TYPES = new Set<string>(['invoice', 'customer', 'payment']);

// ─── List reconciliation runs ────────────────────────────────────────────────

export const listReconciliationRunsHandler = wrapHandler(async (ctx) => {
  const limit = Math.min(
    Number(ctx.event.queryStringParameters?.limit ?? 50),
    200,
  );
  const offset = Number(ctx.event.queryStringParameters?.offset ?? 0);

  const service = createReconciliationService();
  const runs = await service.listRuns(limit, offset);

  return jsonResponse(200, { items: runs, limit, offset });
}, { requireAuth: false });

// ─── Trigger reconciliation ──────────────────────────────────────────────────

export const triggerReconciliationHandler = wrapHandler(async (ctx) => {
  const service = createReconciliationService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  const run = await service.runReconciliation(context);

  return jsonResponse(202, {
    runId: run.id,
    status: run.status,
    totalRecords: run.totalRecords,
    matchedCount: run.matchedCount,
    mismatchCount: run.mismatchCount,
    errorCount: run.errorCount,
    message: 'Reconciliation completed.',
  });
}, { requireAuth: false });

// ─── Get reconciliation run ─────────────────────────────────────────────────

export const getReconciliationRunHandler = wrapHandler(async (ctx) => {
  const runId = ctx.event.pathParameters?.id;
  if (!runId) {
    return jsonResponse(400, { message: 'Run ID is required.' });
  }

  const service = createReconciliationService();
  const summary = await service.getRunSummary(runId);
  if (!summary) {
    return jsonResponse(404, { message: `Reconciliation run not found: ${runId}` });
  }

  return jsonResponse(200, summary);
}, { requireAuth: false });

// ─── List mismatches ─────────────────────────────────────────────────────────

export const listMismatchesHandler = wrapHandler(async (ctx) => {
  const runId = ctx.event.queryStringParameters?.runId;

  const service = createReconciliationService();
  const mismatches = await service.listMismatches(runId ?? undefined);

  return jsonResponse(200, { items: mismatches, count: mismatches.length });
}, { requireAuth: false });

// ─── Resolve reconciliation record ──────────────────────────────────────────

interface ResolveReconciliationBody {
  notes: string;
}

export const resolveReconciliationHandler = wrapHandler(async (ctx) => {
  const recordId = ctx.event.pathParameters?.id;
  if (!recordId) {
    return jsonResponse(400, { message: 'Record ID is required.' });
  }

  const body = parseBody<ResolveReconciliationBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  if (!body.value.notes) {
    return jsonResponse(422, { message: 'notes field is required.' });
  }

  const service = createReconciliationService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  try {
    const resolved = await service.resolveRecord(
      recordId,
      { resolvedBy: context.actorId, notes: body.value.notes },
      context,
    );
    return jsonResponse(200, resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) {
      return jsonResponse(404, { message });
    }
    if (message.includes('Can only resolve MISMATCH')) {
      return jsonResponse(409, { message });
    }
    return jsonResponse(500, { message });
  }
}, { requireAuth: false });

// ─── Get failure summary ─────────────────────────────────────────────────────

export const getFailureSummaryHandler = wrapHandler(async (_ctx) => {
  const service = createFailureQueueService();
  const summary = await service.getFailureSummary();

  return jsonResponse(200, summary);
}, { requireAuth: false });

// ─── Retry failed records ────────────────────────────────────────────────────

interface RetryFailedBody {
  type?: string;
  recordId?: string;
}

export const retryFailedHandler = wrapHandler(async (ctx) => {
  const body = parseBody<RetryFailedBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  if (body.value.type && !VALID_FAILURE_TYPES.has(body.value.type)) {
    return jsonResponse(422, {
      message: `Invalid type. Must be one of: ${[...VALID_FAILURE_TYPES].join(', ')}`,
    });
  }

  const service = createFailureQueueService();
  const context = {
    correlationId: ctx.correlationId,
    actorId: ctx.actorUserId ?? 'system',
    module: 'accounting',
  };

  const type = body.value.type as SyncRecordType | undefined;

  if (body.value.recordId && body.value.type) {
    const result = await service.retryRecord(
      body.value.type as SyncRecordType,
      body.value.recordId,
      context,
    );
    return jsonResponse(200, result);
  }

  const results = await service.retryAll(type, context);
  return jsonResponse(200, {
    retried: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  });
}, { requireAuth: false });

// ─── Operational ledger preview ─────────────────────────────────────────────

export const listOperationalLedgerHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const limit = parseLedgerLimit(qs.limit);
  const offset = parseLedgerOffset(qs.offset);
  const sourceType = qs.sourceType as OperationalLedgerSourceType | undefined;
  const status = qs.status as OperationalLedgerStatus | undefined;

  if (sourceType && !OPERATIONAL_LEDGER_SOURCE_TYPES.has(sourceType)) {
    return jsonResponse(422, {
      message: `Invalid sourceType. Must be one of: ${[...OPERATIONAL_LEDGER_SOURCE_TYPES].join(', ')}`,
    });
  }
  if (status && !OPERATIONAL_LEDGER_STATUSES.has(status)) {
    return jsonResponse(422, {
      message: `Invalid status. Must be one of: ${[...OPERATIONAL_LEDGER_STATUSES].join(', ')}`,
    });
  }

  const take = Math.min(limit + offset, 200);
  const snapshot = await loadOperationalLedgerSnapshot(take);
  const entries = snapshot.entries
    .filter((entry) => !sourceType || entry.sourceType === sourceType)
    .filter((entry) => !status || entry.status === status)
    .sort((a, b) => Date.parse(b.ledgerDate) - Date.parse(a.ledgerDate));

  return jsonResponse(200, {
    items: entries.slice(offset, offset + limit),
    total: entries.length,
    limit,
    offset,
    summary: summarizeLedgerEntries(entries, snapshot.exceptions),
    postingRules: OPERATIONAL_LEDGER_POSTING_RULES,
  });
}, { requireAuth: false });

// ─── Accounting journals ────────────────────────────────────────────────────

export const listAccountingJournalsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const limit = parseJournalLimit(qs.limit);
  const offset = parseJournalOffset(qs.offset);
  const sourceType = qs.sourceType as OperationalLedgerSourceType | undefined;
  const status = qs.status as AccountingJournalStatus | undefined;

  if (sourceType && !OPERATIONAL_LEDGER_SOURCE_TYPES.has(sourceType)) {
    return jsonResponse(422, {
      message: `Invalid sourceType. Must be one of: ${[...OPERATIONAL_LEDGER_SOURCE_TYPES].join(', ')}`,
    });
  }
  if (status && !ACCOUNTING_JOURNAL_STATUSES.has(status)) {
    return jsonResponse(422, {
      message: `Invalid status. Must be one of: ${[...ACCOUNTING_JOURNAL_STATUSES].join(', ')}`,
    });
  }

  const [rows, total] = await Promise.all([
    accountingJournalQueries.list({ take: limit, skip: offset, sourceType, status }),
    accountingJournalQueries.count({ sourceType, status }),
  ]);
  const items = rows.map(mapJournal);

  return jsonResponse(200, {
    items,
    total,
    limit,
    offset,
    summary: summarizeJournals(items),
  });
}, { requireAuth: false });

export const postOperationalLedgerJournalsHandler = wrapHandler(async (ctx) => {
  const body = parseBody<JournalPostRequest>(ctx.event);
  if (!body.ok) {
    return jsonResponse(400, { message: body.error });
  }
  if (body.value.confirm !== true) {
    return jsonResponse(400, {
      message: 'Set confirm=true to post operational ledger entries into immutable journals.',
    });
  }
  if (
    body.value.sourceType &&
    !OPERATIONAL_LEDGER_SOURCE_TYPES.has(body.value.sourceType)
  ) {
    return jsonResponse(422, {
      message: `Invalid sourceType. Must be one of: ${[...OPERATIONAL_LEDGER_SOURCE_TYPES].join(', ')}`,
    });
  }

  const limit = parseJournalLimit(body.value.limit, 100);
  const snapshot = await loadOperationalLedgerSnapshot(limit);
  const sourceEntries = snapshot.entries.filter(
    (entry) => !body.value.sourceType || entry.sourceType === body.value.sourceType,
  );
  const candidates = sourceEntries
    .filter(isPostableOperationalEntry)
    .slice(0, limit);

  const posted: AccountingJournalResponse[] = [];
  const skipped = {
    notPostable: sourceEntries.length - candidates.length,
    existing: 0,
  };

  for (const entry of candidates) {
    const existing = await accountingJournalQueries.findBySource(entry);
    if (existing) {
      skipped.existing += 1;
      posted.push(mapJournal(existing));
      continue;
    }

    const journal = await accountingJournalQueries.createFromOperationalEntry(entry, {
      actorId: ctx.actorUserId ?? 'system',
      correlationId: ctx.correlationId,
    });
    posted.push(mapJournal(journal));
  }

  return jsonResponse(201, {
    posted,
    postedCount: posted.length - skipped.existing,
    skipped,
    summary: summarizeJournals(posted),
  });
}, { requireAuth: false });

// ─── Mapping service factory ──────────────────────────────────────────────────

function createMappingService(): MappingService {
  return new MappingService({ queries: mappingQueries });
}

const VALID_DIMENSION_TYPES = new Set<string>(Object.values(DimensionMappingType));

// ─── List dimension mappings ──────────────────────────────────────────────────

export const listDimensionMappingsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const integrationAccountId = qs.integrationAccountId;
  if (!integrationAccountId) {
    return jsonResponse(400, { message: 'integrationAccountId query parameter is required.' });
  }

  const service = createMappingService();
  const items = await service.listDimensionMappings(integrationAccountId, qs.namespace ?? 'default');
  return jsonResponse(200, { items, total: items.length });
}, { requireAuth: false });

// ─── Upsert dimension mapping ─────────────────────────────────────────────────

export const upsertDimensionMappingHandler = wrapHandler(async (ctx) => {
  const body = parseBody<UpsertDimensionInput>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { integrationAccountId, mappingType, internalCode, externalId } = body.value;
  if (!integrationAccountId || !mappingType || !internalCode || !externalId) {
    return jsonResponse(422, {
      message: 'integrationAccountId, mappingType, internalCode, and externalId are required.',
    });
  }
  if (!VALID_DIMENSION_TYPES.has(mappingType)) {
    return jsonResponse(422, {
      message: `Invalid mappingType. Must be one of: ${[...VALID_DIMENSION_TYPES].join(', ')}`,
    });
  }

  const service = createMappingService();
  const result = await service.upsertDimensionMapping(body.value);
  return jsonResponse(200, result);
}, { requireAuth: false });

// ─── List tax mappings ────────────────────────────────────────────────────────

export const listTaxMappingsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const integrationAccountId = qs.integrationAccountId;
  if (!integrationAccountId) {
    return jsonResponse(400, { message: 'integrationAccountId query parameter is required.' });
  }

  const service = createMappingService();
  const items = await service.listTaxMappings(integrationAccountId, qs.namespace ?? 'default');
  return jsonResponse(200, { items, total: items.length });
}, { requireAuth: false });

// ─── Upsert tax mapping ───────────────────────────────────────────────────────

export const upsertTaxMappingHandler = wrapHandler(async (ctx) => {
  const body = parseBody<UpsertTaxInput>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { integrationAccountId, taxRegionCode, internalTaxCode, externalTaxCodeId } = body.value;
  if (!integrationAccountId || !taxRegionCode || !internalTaxCode || !externalTaxCodeId) {
    return jsonResponse(422, {
      message:
        'integrationAccountId, taxRegionCode, internalTaxCode, and externalTaxCodeId are required.',
    });
  }

  const service = createMappingService();
  const result = await service.upsertTaxMapping(body.value);
  return jsonResponse(200, result);
}, { requireAuth: false });
