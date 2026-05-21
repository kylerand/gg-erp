/**
 * QuickBooks webhook receiver Lambda handler.
 *
 * QB sends notifications when entities change (invoices paid, customers updated, etc.).
 * This handler:
 *   1. Validates the webhook signature using the QB webhook verifier token
 *   2. Persists raw events to the webhook_inbox_events table
 *   3. For Payment entities, creates PaymentSyncRecords for async processing
 *   4. Emits a domain event for async processing by workers
 *
 * QB webhook payload format:
 *   { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation, lastUpdated }] } }] }
 *
 * Signature verification:
 *   QB sends an `intuit-signature` header containing an HMAC-SHA256 of the body
 *   using the webhook verifier token (configured in the QB app dashboard).
 */
import { PrismaClient } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';
import { createTokenManager } from '../../contexts/accounting/quickbooks.tokenManager.js';
import { QuickBooksClient } from '../../contexts/accounting/quickbooks.client.js';
import {
  PaymentSyncService,
  paymentSyncQueries,
  prismaPaymentSyncResolvers,
  type PaymentSyncServiceDeps,
} from '../../contexts/accounting/paymentSync.service.js';
import { InMemoryAuditSink } from '../../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../../events/index.js';
import { ConsoleObservabilityHooks } from '../../observability/index.js';

const prisma = new PrismaClient();
const tokenManager = createTokenManager();

export interface QbWebhookEntity {
  name: string;
  id: string;
  operation: 'Create' | 'Update' | 'Delete' | 'Merge' | 'Void';
  lastUpdated: string;
}

interface QbWebhookNotification {
  realmId: string;
  dataChangeEvent: {
    entities: QbWebhookEntity[];
  };
}

interface QbWebhookPayload {
  eventNotifications: QbWebhookNotification[];
}

const WEBHOOK_OPERATIONS = new Set(['Create', 'Update', 'Delete', 'Merge', 'Void']);

function getHeader(
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWebhookPayload(
  rawBody: string,
): { ok: true; value: QbWebhookPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'Invalid JSON payload' };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.eventNotifications)) {
    return { ok: false, error: 'eventNotifications must be an array.' };
  }

  const eventNotifications = parsed.eventNotifications;

  for (const notification of eventNotifications) {
    if (!isRecord(notification) || typeof notification.realmId !== 'string') {
      return { ok: false, error: 'Each event notification must include a realmId.' };
    }

    const dataChangeEvent = notification.dataChangeEvent;
    if (!isRecord(dataChangeEvent) || !Array.isArray(dataChangeEvent.entities)) {
      return { ok: false, error: 'Each event notification must include entities.' };
    }

    for (const entity of dataChangeEvent.entities) {
      if (
        !isRecord(entity) ||
        typeof entity.name !== 'string' ||
        typeof entity.id !== 'string' ||
        typeof entity.operation !== 'string' ||
        !WEBHOOK_OPERATIONS.has(entity.operation) ||
        typeof entity.lastUpdated !== 'string'
      ) {
        return { ok: false, error: 'Each webhook entity must include valid entity fields.' };
      }
    }
  }

  return {
    ok: true,
    value: { eventNotifications: eventNotifications as QbWebhookNotification[] },
  };
}

/**
 * Verify the QB webhook HMAC signature.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  verifierToken: string,
): boolean {
  const hash = createHmac('sha256', verifierToken)
    .update(payload)
    .digest('base64');
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Extract Payment entities with Create or Update operations from webhook notifications.
 */
export function extractPaymentEntities(
  notifications: QbWebhookNotification[],
): QbWebhookEntity[] {
  const result: QbWebhookEntity[] = [];
  for (const notification of notifications) {
    for (const entity of notification.dataChangeEvent.entities) {
      if (
        entity.name === 'Payment' &&
        (entity.operation === 'Create' || entity.operation === 'Update')
      ) {
        result.push(entity);
      }
    }
  }
  return result;
}

function createPaymentSyncServiceForWebhook(): PaymentSyncService {
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

export const webhookHandler = wrapHandler(async (ctx) => {
  const rawBody = ctx.event.body ?? '';
  const signature = getHeader(ctx.event.headers, 'intuit-signature')?.trim() ?? '';

  // QB sends a validation request with empty body during setup
  if (!rawBody) {
    return jsonResponse(200, { message: 'OK' });
  }

  if (!signature) {
    return jsonResponse(400, { message: 'intuit-signature header is required.' });
  }

  const payloadResult = parseWebhookPayload(rawBody);
  if (!payloadResult.ok) {
    return jsonResponse(400, { message: payloadResult.error });
  }
  const payload = payloadResult.value;

  const verifierToken = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
  if (!verifierToken) {
    return jsonResponse(500, { message: 'QB webhook verifier token not configured' });
  }

  if (!verifyWebhookSignature(rawBody, signature, verifierToken)) {
    return jsonResponse(401, { message: 'Invalid webhook signature' });
  }

  const correlationId = randomUUID();
  const results: Array<{ eventId: string; entityName: string; entityId: string }> = [];

  for (const notification of payload.eventNotifications) {
    const realmId = notification.realmId;

    // Find the integration account for this realm
    const integrationAccount = await prisma.integrationAccount.findFirst({
      where: { provider: 'QUICKBOOKS', accountKey: realmId, accountStatus: 'ACTIVE' },
    });

    if (!integrationAccount) {
      continue; // Skip notifications for unknown/disconnected accounts
    }

    for (const entity of notification.dataChangeEvent.entities) {
      const providerEventId = `${realmId}-${entity.name}-${entity.id}-${entity.lastUpdated}`;

      // Idempotent insert — skip if we've already processed this event
      const existing = await prisma.webhookInboxEvent.findUnique({
        where: {
          integrationAccountId_providerEventId: {
            integrationAccountId: integrationAccount.id,
            providerEventId,
          },
        },
      });

      if (existing) {
        continue;
      }

      const inboxEvent = await prisma.webhookInboxEvent.create({
        data: {
          integrationAccountId: integrationAccount.id,
          providerEventId,
          eventType: `${entity.name}.${entity.operation}`,
          payload: {
            name: entity.name,
            id: entity.id,
            operation: entity.operation,
            lastUpdated: entity.lastUpdated,
            realmId,
          },
          processingStatus: 'RECEIVED',
          correlationId,
        },
      });

      results.push({
        eventId: inboxEvent.id,
        entityName: entity.name,
        entityId: entity.id,
      });
    }
  }

  // QB expects a 200 response — any non-200 causes retries
  // Process Payment entities asynchronously after inbox persistence
  const paymentEntities = extractPaymentEntities(payload.eventNotifications);
  if (paymentEntities.length > 0) {
    try {
      const tokens = await tokenManager.getValidTokens();
      const qbClient = new QuickBooksClient(tokens);
      const paymentService = createPaymentSyncServiceForWebhook();
      const syncCtx = {
        correlationId,
        actorId: 'webhook',
        module: 'accounting',
      };

      for (const entity of paymentEntities) {
        try {
          const payment = await qbClient.getPayment(entity.id);
          await paymentService.createFromWebhook(
            {
              qbPaymentId: entity.id,
              qbInvoiceId: payment.linkedInvoiceId,
              amountCents: payment.totalAmountCents,
              paymentMethod: payment.paymentMethod,
              paymentDate: payment.txnDate,
            },
            syncCtx,
          );
        } catch {
          // Log and continue — inbox event is the source of truth
        }
      }
    } catch {
      // Token/service setup failed — payment sync skipped; inbox events preserved
    }
  }

  return jsonResponse(200, {
    received: results.length,
    correlationId,
  });
}, { requireAuth: false });
