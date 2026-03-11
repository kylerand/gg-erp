import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  QuickBooksClient,
  type QbTokens,
} from '../../contexts/accounting/quickbooks.client.js';

const prisma = new PrismaClient();

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

export const oauthCallbackHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const { code, realmId, error } = qs;

  if (error) {
    return jsonResponse(400, { message: `QB OAuth error: ${error}` });
  }
  if (!code || !realmId) {
    return jsonResponse(400, { message: 'Missing code or realmId from QB callback.' });
  }

  let tokens: QbTokens;
  try {
    tokens = await exchangeCodeForTokens(code, realmId);
  } catch (err) {
    return jsonResponse(502, { message: err instanceof Error ? err.message : 'Token exchange failed' });
  }

  // Store tokens in Secrets Manager (or env for now — prod should use SecretsManager PutSecretValue)
  // For MVP, return the tokens to the caller to store manually since there's no credential table yet.
  const redirectUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/accounting/sync?connected=true&realmId=${tokens.realmId}`
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
}, { requireAuth: false });

// ─── Get QB connection status ─────────────────────────────────────────────────

export const qbStatusHandler = wrapHandler(async (_ctx) => {
  const accessToken = process.env.QB_ACCESS_TOKEN;
  const realmId = process.env.QB_REALM_ID;

  if (!accessToken || !realmId) {
    return jsonResponse(200, { connected: false, message: 'QuickBooks not connected.' });
  }

  try {
    const client = new QuickBooksClient({ accessToken, refreshToken: '', realmId, expiresAt: 0 });
    const info = await client.getCompanyInfo();
    return jsonResponse(200, { connected: true, companyName: info.companyName, realmId: info.realmId });
  } catch (err) {
    return jsonResponse(200, {
      connected: false,
      message: err instanceof Error ? err.message : 'QB connection check failed',
    });
  }
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
