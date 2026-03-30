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
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { status } = body.value;
  if (!status || !VALID_STATUSES.has(status)) {
    return jsonResponse(422, {
      message: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`,
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
