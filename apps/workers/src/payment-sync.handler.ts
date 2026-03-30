/**
 * Payment sync worker Lambda handler.
 *
 * Triggered by EventBridge schedule or SQS queue. Processes PENDING
 * PaymentSyncRecords in batches — fetches records from the DB, transitions
 * each through IN_PROGRESS → SYNCED | FAILED.
 *
 * Follows the same Prisma-direct pattern as qb-invoice-sync.job.ts.
 */
import { PrismaClient } from '@prisma/client';
import { consoleWorkerLogger } from './observability/logger.js';
import { consoleWorkerMetrics } from './observability/metrics.js';

const prisma = new PrismaClient();
const DEFAULT_BATCH_SIZE = 10;

export interface PaymentSyncWorkerEvent {
  batchSize?: number;
}

export interface PaymentSyncWorkerResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function handler(
  event?: PaymentSyncWorkerEvent,
): Promise<{ statusCode: number; body: string }> {
  const batchSize = event?.batchSize ?? DEFAULT_BATCH_SIZE;

  consoleWorkerLogger.info('Payment sync worker invoked', { batchSize });

  const pendingRecords = await prisma.paymentSyncRecord.findMany({
    where: { state: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  const results: PaymentSyncWorkerResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const record of pendingRecords) {
    results.processed++;

    try {
      // Transition to IN_PROGRESS
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

      // Verify linked invoice sync record
      if (record.qbInvoiceId) {
        const invoiceSync = await prisma.invoiceSyncRecord.findFirst({
          where: { externalReference: record.qbInvoiceId },
        });
        if (!invoiceSync) {
          throw new Error(
            `No invoice sync found for QB invoice: ${record.qbInvoiceId}`,
          );
        }
      }

      // Verify work order and customer
      const workOrder = await prisma.woOrder.findUnique({
        where: { id: record.workOrderId },
        select: { id: true, customerReference: true },
      });
      if (!workOrder) {
        throw new Error(`Work order not found: ${record.workOrderId}`);
      }

      // Mark SYNCED
      await prisma.paymentSyncRecord.update({
        where: { id: record.id },
        data: {
          state: 'SYNCED',
          updatedAt: new Date(),
        },
      });

      results.succeeded++;
      consoleWorkerMetrics.increment('worker.payment_sync.succeeded', 1, {});
      consoleWorkerLogger.info('Payment sync succeeded', {
        paymentSyncId: record.id,
        qbPaymentId: record.qbPaymentId,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';

      await prisma.paymentSyncRecord.update({
        where: { id: record.id },
        data: {
          state: 'FAILED',
          errorMessage,
          updatedAt: new Date(),
        },
      });

      results.failed++;
      consoleWorkerMetrics.increment('worker.payment_sync.failed', 1, {});
      consoleWorkerLogger.error('Payment sync failed', {
        paymentSyncId: record.id,
        error: errorMessage,
      });
    }
  }

  consoleWorkerLogger.info('Payment sync worker completed', results);

  return {
    statusCode: 200,
    body: JSON.stringify(results),
  };
}
