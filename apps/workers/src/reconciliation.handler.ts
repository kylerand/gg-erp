/**
 * Reconciliation worker Lambda handler.
 *
 * Triggered by EventBridge schedule (daily). Runs the full reconciliation
 * engine — comparing ERP sync records against QuickBooks references —
 * and logs the summary.
 */
import { PrismaClient } from '@prisma/client';
import { consoleWorkerLogger } from './observability/logger.js';
import { consoleWorkerMetrics } from './observability/metrics.js';

const prisma = new PrismaClient();

export interface ReconciliationWorkerEvent {
  triggeredBy?: string;
}

export interface ReconciliationWorkerResult extends Record<string, unknown> {
  runId: string;
  status: string;
  totalRecords: number;
  matchedCount: number;
  mismatchCount: number;
  errorCount: number;
}

export async function handler(
  event?: ReconciliationWorkerEvent,
): Promise<{ statusCode: number; body: string }> {
  consoleWorkerLogger.info('Reconciliation worker invoked', {
    triggeredBy: event?.triggeredBy ?? 'schedule',
  });

  try {
    // Create a new reconciliation run
    const run = await prisma.reconciliationRun.create({
      data: {
        status: 'RUNNING',
        triggeredBy: event?.triggeredBy ?? 'scheduled-worker',
      },
    });

    const stats = { totalRecords: 0, matchedCount: 0, mismatchCount: 0, errorCount: 0 };

    // Reconcile synced invoices
    const invoices = await prisma.invoiceSyncRecord.findMany({
      where: { state: 'SYNCED' },
      select: { id: true, invoiceNumber: true, externalReference: true },
    });

    for (const invoice of invoices) {
      stats.totalRecords++;
      try {
        const hasQbRef = !!invoice.externalReference;
        const status = hasQbRef ? 'MATCHED' : 'MISMATCH';
        if (hasQbRef) stats.matchedCount++;
        else stats.mismatchCount++;

        await prisma.reconciliationRecord.create({
          data: {
            reconciliationType: 'INVOICE',
            erpRecordId: invoice.id,
            qbRecordId: invoice.externalReference,
            status,
            discrepancy: hasQbRef ? null : 'Invoice synced but no QB external reference found',
            runId: run.id,
          },
        });
      } catch (err) {
        stats.errorCount++;
        consoleWorkerLogger.error('Failed to reconcile invoice', {
          invoiceId: invoice.id,
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }
    }

    // Reconcile synced payments
    const payments = await prisma.paymentSyncRecord.findMany({
      where: { state: 'SYNCED' },
      select: { id: true, qbPaymentId: true, amountCents: true },
    });

    for (const payment of payments) {
      stats.totalRecords++;
      try {
        const hasQbPayment = !!payment.qbPaymentId;
        const status = hasQbPayment ? 'MATCHED' : 'MISMATCH';
        if (hasQbPayment) stats.matchedCount++;
        else stats.mismatchCount++;

        await prisma.reconciliationRecord.create({
          data: {
            reconciliationType: 'PAYMENT',
            erpRecordId: payment.id,
            qbRecordId: payment.qbPaymentId,
            status,
            erpAmountCents: payment.amountCents,
            discrepancy: hasQbPayment ? null : 'Payment synced but no QB payment ID found',
            runId: run.id,
          },
        });
      } catch (err) {
        stats.errorCount++;
        consoleWorkerLogger.error('Failed to reconcile payment', {
          paymentId: payment.id,
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }
    }

    // Complete the run
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        ...stats,
      },
    });

    const result: ReconciliationWorkerResult = {
      runId: run.id,
      status: 'COMPLETED',
      ...stats,
    };

    consoleWorkerLogger.info('Reconciliation worker completed', result);
    consoleWorkerMetrics.increment('worker.reconciliation.completed', 1, {});

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    consoleWorkerLogger.error('Reconciliation worker failed', {
      error: errorMessage,
    });
    consoleWorkerMetrics.increment('worker.reconciliation.failed', 1, {});

    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
}
