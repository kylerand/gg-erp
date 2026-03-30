/**
 * QuickBooks invoice sync worker job.
 *
 * Triggered on work_order.completed events. Creates a PENDING InvoiceSyncRecord
 * in the DB, which the accounting Lambda then processes on next poll/trigger.
 *
 * The actual QB API call happens in apps/api/src/lambda/accounting (trigger-sync Lambda)
 * keeping the QB client isolated to the Lambda package.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';
import type { WorkerEvent } from '../events/subscribers.js';

const prisma = new PrismaClient();

export interface QbSyncResult {
  workOrderId: string;
  invoiceSyncRecordId: string;
  status: 'queued' | 'skipped';
}

export async function handleWorkOrderCompletedForQb(
  event: WorkerEvent,
  logger: WorkerLogger,
  metrics: WorkerMetrics
): Promise<QbSyncResult> {
  const payload = event.payload as { id?: string; workOrderNumber?: string };
  const workOrderId = payload?.id;

  if (!workOrderId) {
    throw new Error('work_order.completed payload must include id');
  }

  logger.info('Queuing QB invoice sync for completed work order', {
    correlationId: event.correlationId,
    workOrderId,
  });

  const existing = await prisma.invoiceSyncRecord.findFirst({
    where: { workOrderId, state: { not: 'CANCELLED' } },
  });

  if (existing) {
    logger.info('QB sync record already exists — skipping', { workOrderId, existingId: existing.id });
    metrics.increment('worker.qb_sync.skipped', 1, { reason: 'already_exists' });
    return { workOrderId, invoiceSyncRecordId: existing.id, status: 'skipped' };
  }

  const workOrder = await prisma.woOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) {
    throw new Error(`Work order not found: ${workOrderId}`);
  }

  const invoiceNumber = `INV-${workOrder.workOrderNumber}`;
  const now = new Date();

  const record = await prisma.invoiceSyncRecord.create({
    data: {
      id: randomUUID(),
      invoiceNumber,
      workOrderId,
      provider: 'QUICKBOOKS',
      state: 'PENDING',
      attemptCount: 0,
      correlationId: event.correlationId ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    },
  });

  metrics.increment('worker.qb_sync.queued', 1, {});
  logger.info('QB invoice sync record created', { invoiceSyncRecordId: record.id, invoiceNumber });

  return { workOrderId, invoiceSyncRecordId: record.id, status: 'queued' };
}
