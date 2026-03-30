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
  const verifierToken = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
  if (!verifierToken) {
    return jsonResponse(500, { message: 'QB webhook verifier token not configured' });
  }

  const rawBody = ctx.event.body ?? '';
  const signature = ctx.event.headers?.['intuit-signature'] ?? '';

  // QB sends a validation request with empty body during setup
  if (!rawBody) {
    return jsonResponse(200, { message: 'OK' });
  }

  if (!verifyWebhookSignature(rawBody, signature, verifierToken)) {
    return jsonResponse(401, { message: 'Invalid webhook signature' });
  }

  let payload: QbWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as QbWebhookPayload;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON payload' });
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
