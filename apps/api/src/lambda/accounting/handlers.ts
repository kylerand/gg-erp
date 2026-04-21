import { PrismaClient } from '@prisma/client';
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

const prisma = new PrismaClient();
const tokenManager = createTokenManager();

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
  return processQbStatus({
    getValidTokens: () => tokenManager.getValidTokens(),
    getCompanyInfo: (tokens) => new QuickBooksClient(tokens).getCompanyInfo(),
  });
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

  return jsonResponse(200, {
    items: items.map((r) => ({
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

  return jsonResponse(200, {
    items: items.map((r) => ({
      id: r.id,
      customerId: r.customerId,
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
