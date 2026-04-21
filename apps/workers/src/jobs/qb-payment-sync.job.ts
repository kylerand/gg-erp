/**
 * QuickBooks payment sync worker job.
 *
 * Triggered on qb.webhook.received events. Finds the PaymentSyncRecord that
 * was created by the webhook intake handler and processes it immediately,
 * rather than waiting for the next scheduled batch run.
 *
 * The scheduled payment-sync.handler.ts acts as a safety net for any records
 * that were not processed reactively (e.g. worker was down when the webhook arrived).
 */
import { PrismaClient } from '@prisma/client';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';
import type { WorkerEvent } from '../events/subscribers.js';

const prisma = new PrismaClient();

export interface QbPaymentSyncResult {
  webhookEventId: string;
  status: 'processed' | 'skipped' | 'failed';
  paymentSyncId?: string;
  errorMessage?: string;
}

interface WebhookReceivedPayload {
  webhookEventId?: string;
  eventType?: string;
}

export async function handleWebhookReceivedForPaymentSync(
  event: WorkerEvent,
  logger: WorkerLogger,
  metrics: WorkerMetrics,
): Promise<QbPaymentSyncResult> {
  const payload = event.payload as WebhookReceivedPayload;
  const webhookEventId = payload?.webhookEventId;

  if (!webhookEventId) {
    throw new Error('qb.webhook.received payload must include webhookEventId');
  }

  logger.info('Processing QB webhook for payment sync', {
    correlationId: event.correlationId,
    webhookEventId,
    eventType: payload.eventType,
  });

  // Find the oldest PENDING PaymentSyncRecord. The webhook handler creates
  // the record synchronously before emitting this event, so the newest PENDING
  // record is the one we want to process. No FK exists between WebhookInboxEvent
  // and PaymentSyncRecord, so we process by arrival order.
  const record = await prisma.paymentSyncRecord.findFirst({
    where: { state: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  if (!record) {
    logger.info('No pending PaymentSyncRecord — already processed or not a payment event', {
      webhookEventId,
    });
    metrics.increment('worker.qb_payment_sync.skipped', 1, { reason: 'no_pending_record' });
    return { webhookEventId, status: 'skipped' };
  }

  try {
    await prisma.paymentSyncRecord.update({
      where: { id: record.id },
      data: {
        state: 'IN_PROGRESS',
        attemptCount: record.attemptCount + 1,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      },
    });

    // Verify work order still exists
    const workOrder = await prisma.woOrder.findUnique({
      where: { id: record.workOrderId },
      select: { id: true },
    });
    if (!workOrder) {
      throw new Error(`Work order not found: ${record.workOrderId}`);
    }

    // Verify invoice sync linkage when a QB invoice ID is present
    if (record.qbInvoiceId) {
      const invoiceSync = await prisma.invoiceSyncRecord.findFirst({
        where: { externalReference: record.qbInvoiceId },
      });
      if (!invoiceSync) {
        throw new Error(`No invoice sync record found for QB invoice: ${record.qbInvoiceId}`);
      }
    }

    await prisma.paymentSyncRecord.update({
      where: { id: record.id },
      data: { state: 'SYNCED', updatedAt: new Date() },
    });

    metrics.increment('worker.qb_payment_sync.succeeded', 1, {});
    logger.info('Payment sync succeeded via webhook trigger', {
      paymentSyncId: record.id,
      qbPaymentId: record.qbPaymentId,
    });

    return { webhookEventId, status: 'processed', paymentSyncId: record.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await prisma.paymentSyncRecord.update({
      where: { id: record.id },
      data: { state: 'FAILED', errorMessage, updatedAt: new Date() },
    });

    metrics.increment('worker.qb_payment_sync.failed', 1, {});
    logger.error('Payment sync failed via webhook trigger', {
      paymentSyncId: record.id,
      error: errorMessage,
    });

    return { webhookEventId, status: 'failed', paymentSyncId: record.id, errorMessage };
  }
}
