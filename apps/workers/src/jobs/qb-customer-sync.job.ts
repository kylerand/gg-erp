/**
 * QuickBooks customer sync worker job.
 *
 * Triggered on customer.created and customer.updated events.
 * Ensures the customer exists in QuickBooks before any invoice sync.
 *
 * Creates a sync record in the DB which the accounting sync processor
 * can pick up for batch processing, or processes inline if tokens are available.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';
import type { WorkerEvent } from '../events/subscribers.js';

const prisma = new PrismaClient();

export interface QbCustomerSyncResult {
  customerId: string;
  status: 'queued' | 'skipped' | 'already_mapped';
}

interface CustomerEventPayload {
  id?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export async function handleCustomerEventForQb(
  event: WorkerEvent,
  logger: WorkerLogger,
  metrics: WorkerMetrics
): Promise<QbCustomerSyncResult> {
  const payload = event.payload as CustomerEventPayload;
  const customerId = payload?.id;

  if (!customerId) {
    throw new Error('customer event payload must include id');
  }

  logger.info('Processing customer event for QB sync', {
    correlationId: event.correlationId,
    customerId,
    eventName: event.name,
  });

  // Check if an active QB integration account exists
  const integrationAccount = await prisma.integrationAccount.findFirst({
    where: { provider: 'QUICKBOOKS', accountStatus: 'ACTIVE' },
  });

  if (!integrationAccount) {
    logger.info('No active QB integration — skipping customer sync', { customerId });
    metrics.increment('worker.qb_customer_sync.skipped', 1, { reason: 'no_integration' });
    return { customerId, status: 'skipped' };
  }

  // Check if mapping already exists
  const existingMapping = await prisma.externalIdMapping.findUnique({
    where: {
      integrationAccountId_entityType_entityId_namespace: {
        integrationAccountId: integrationAccount.id,
        entityType: 'Customer',
        entityId: customerId,
        namespace: 'default',
      },
    },
  });

  if (existingMapping?.isActive) {
    logger.info('Customer already mapped to QB — skipping', {
      customerId,
      qbId: existingMapping.externalId,
    });
    metrics.increment('worker.qb_customer_sync.skipped', 1, { reason: 'already_mapped' });
    return { customerId, status: 'already_mapped' };
  }

  // Create a sync job item for batch processing
  const correlationId = event.correlationId ?? randomUUID();
  const displayName =
    payload.displayName ??
    [payload.firstName, payload.lastName].filter(Boolean).join(' ') ??
    `Customer-${customerId.slice(0, 8)}`;

  await prisma.syncJob.create({
    data: {
      id: randomUUID(),
      integrationAccountId: integrationAccount.id,
      jobType: 'CUSTOMER_PUSH',
      direction: 'PUSH',
      jobStatus: 'QUEUED',
      correlationId,
      items: {
        create: {
          id: randomUUID(),
          entityType: 'Customer',
          entityId: customerId,
          itemStatus: 'PENDING',
          payload: {
            customerId,
            displayName,
            email: payload.email,
          },
        },
      },
    },
  });

  metrics.increment('worker.qb_customer_sync.queued', 1, {});
  logger.info('QB customer sync job created', { customerId, correlationId });

  return { customerId, status: 'queued' };
}
