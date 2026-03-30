/**
 * Payment sync service — manages the lifecycle of syncing inbound QB payments
 * to GG work orders.
 *
 * State machine:
 *   PENDING → IN_PROGRESS → SYNCED | FAILED
 *                                      ↓
 *                            FAILED → IN_PROGRESS (retry)
 *
 * Follows the same DB-backed pattern as InvoiceSyncService and CustomerSyncService.
 */
import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  PaymentSyncState as PrismaPaymentSyncState,
  SyncDirection as PrismaSyncDirection,
} from '@prisma/client';
import type { PaymentSyncRecord as PrismaPaymentSyncModel } from '@prisma/client';
import {
  assertTransitionAllowed,
  InvariantViolationError,
  PaymentSyncRecordDesign,
  PaymentSyncState,
  type PaymentSyncRecord,
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

// ─── Interfaces ─────────────────────────────────────────────────────────────────

export interface PaymentSyncCommandContext
  extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface PaymentSyncResolvers {
  findInvoiceSyncByQbInvoiceId(
    qbInvoiceId: string,
  ): Promise<{ invoiceSyncId: string; workOrderId: string } | undefined>;
  findCustomerByWorkOrder(workOrderId: string): Promise<string | undefined>;
}

export interface PaymentSyncServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
  queries: PaymentSyncQueries;
  resolvers: PaymentSyncResolvers;
}

export interface CreateFromWebhookInput {
  qbPaymentId: string;
  qbInvoiceId?: string;
  amountCents: number;
  paymentMethod?: string;
  paymentDate?: string;
}

// ─── Prisma singleton ──────────────────────────────────────────────────────────

let paymentSyncPrisma: PrismaClient | undefined;

function getPaymentSyncPrisma(): PrismaClient {
  paymentSyncPrisma ??= new PrismaClient();
  return paymentSyncPrisma;
}

// ─── Domain ↔ Prisma mapping ───────────────────────────────────────────────────

function toDomain(r: PrismaPaymentSyncModel): PaymentSyncRecord {
  return {
    id: r.id,
    invoiceSyncId: r.invoiceSyncId ?? undefined,
    workOrderId: r.workOrderId,
    customerId: r.customerId,
    qbPaymentId: r.qbPaymentId ?? undefined,
    qbInvoiceId: r.qbInvoiceId ?? undefined,
    amountCents: r.amountCents,
    paymentMethod: r.paymentMethod ?? undefined,
    paymentDate: r.paymentDate?.toISOString().split('T')[0],
    state: r.state as string as PaymentSyncState,
    direction: r.direction as 'INBOUND' | 'OUTBOUND',
    errorMessage: r.errorMessage ?? undefined,
    attemptCount: r.attemptCount,
    lastAttemptAt: r.lastAttemptAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Exported query object (mockable in tests) ─────────────────────────────────

export const paymentSyncQueries = {
  async findById(id: string): Promise<PaymentSyncRecord | undefined> {
    const r = await getPaymentSyncPrisma().paymentSyncRecord.findUnique({
      where: { id },
    });
    return r ? toDomain(r) : undefined;
  },

  async findByQbPaymentId(
    qbPaymentId: string,
  ): Promise<PaymentSyncRecord | undefined> {
    const r = await getPaymentSyncPrisma().paymentSyncRecord.findFirst({
      where: { qbPaymentId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toDomain(r) : undefined;
  },

  async listByState(
    state: PaymentSyncState,
    limit = 50,
  ): Promise<PaymentSyncRecord[]> {
    const records = await getPaymentSyncPrisma().paymentSyncRecord.findMany({
      where: { state: state as string as PrismaPaymentSyncState },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return records.map(toDomain);
  },

  async save(record: PaymentSyncRecord): Promise<void> {
    const data = {
      invoiceSyncId: record.invoiceSyncId ?? null,
      workOrderId: record.workOrderId,
      customerId: record.customerId,
      qbPaymentId: record.qbPaymentId ?? null,
      qbInvoiceId: record.qbInvoiceId ?? null,
      amountCents: record.amountCents,
      paymentMethod: record.paymentMethod ?? null,
      paymentDate: record.paymentDate ? new Date(record.paymentDate) : null,
      state: record.state as string as PrismaPaymentSyncState,
      direction: record.direction as string as PrismaSyncDirection,
      errorMessage: record.errorMessage ?? null,
      attemptCount: record.attemptCount,
      lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt) : null,
      updatedAt: new Date(record.updatedAt),
    };

    await getPaymentSyncPrisma().paymentSyncRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  },
};

export type PaymentSyncQueries = typeof paymentSyncQueries;

// ─── Prisma-backed resolvers ────────────────────────────────────────────────────

export const prismaPaymentSyncResolvers: PaymentSyncResolvers = {
  async findInvoiceSyncByQbInvoiceId(qbInvoiceId: string) {
    const record = await getPaymentSyncPrisma().invoiceSyncRecord.findFirst({
      where: { externalReference: qbInvoiceId },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return undefined;
    return { invoiceSyncId: record.id, workOrderId: record.workOrderId };
  },

  async findCustomerByWorkOrder(workOrderId: string) {
    const wo = await getPaymentSyncPrisma().woOrder.findUnique({
      where: { id: workOrderId },
      select: { customerReference: true },
    });
    return wo?.customerReference ?? undefined;
  },
};

// ─── Service ────────────────────────────────────────────────────────────────────

export class PaymentSyncService {
  constructor(private readonly deps: PaymentSyncServiceDeps) {}

  /**
   * Create a PENDING payment sync record from an inbound QB webhook.
   * Resolves workOrderId and customerId via the linked invoice sync record.
   */
  async createFromWebhook(
    input: CreateFromWebhookInput,
    context: PaymentSyncCommandContext,
  ): Promise<PaymentSyncRecord> {
    // Idempotent — return existing record if already queued
    const existing = await this.deps.queries.findByQbPaymentId(input.qbPaymentId);
    if (existing && existing.state !== PaymentSyncState.FAILED) {
      return existing;
    }

    // Resolve workOrderId and customerId via invoice sync record
    if (!input.qbInvoiceId) {
      throw new InvariantViolationError(
        'qbInvoiceId is required to resolve work order and customer',
      );
    }

    const invoiceSync = await this.deps.resolvers.findInvoiceSyncByQbInvoiceId(
      input.qbInvoiceId,
    );
    if (!invoiceSync) {
      throw new InvariantViolationError(
        `No invoice sync record found for QB invoice: ${input.qbInvoiceId}`,
      );
    }

    const customerId = await this.deps.resolvers.findCustomerByWorkOrder(
      invoiceSync.workOrderId,
    );
    if (!customerId) {
      throw new InvariantViolationError(
        `No customer found for work order: ${invoiceSync.workOrderId}`,
      );
    }

    const now = new Date().toISOString();
    const record: PaymentSyncRecord = {
      id: randomUUID(),
      invoiceSyncId: invoiceSync.invoiceSyncId,
      workOrderId: invoiceSync.workOrderId,
      customerId,
      qbPaymentId: input.qbPaymentId,
      qbInvoiceId: input.qbInvoiceId,
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod,
      paymentDate: input.paymentDate,
      state: PaymentSyncState.PENDING,
      direction: 'INBOUND',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.queries.save(record);
    await this.emitEvent(record.id, record, 'payment_sync.started', context);
    return record;
  }

  /**
   * Process a PENDING payment — transitions PENDING → IN_PROGRESS → SYNCED | FAILED.
   * Verifies the linked invoice sync and work order, then marks as synced.
   */
  async processPayment(
    recordId: string,
    context: PaymentSyncCommandContext,
  ): Promise<PaymentSyncRecord> {
    const record = await this.requireRecord(recordId);

    if (record.state !== PaymentSyncState.PENDING) {
      throw new InvariantViolationError(
        `Cannot process payment from state ${record.state}`,
      );
    }

    assertTransitionAllowed(
      record.state,
      PaymentSyncState.IN_PROGRESS,
      PaymentSyncRecordDesign.lifecycle,
    );

    const inProgress: PaymentSyncRecord = {
      ...record,
      state: PaymentSyncState.IN_PROGRESS,
      attemptCount: record.attemptCount + 1,
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorMessage: undefined,
    };
    await this.deps.queries.save(inProgress);

    try {
      // Verify the linked invoice sync record exists
      if (record.qbInvoiceId) {
        const invoiceSync =
          await this.deps.resolvers.findInvoiceSyncByQbInvoiceId(
            record.qbInvoiceId,
          );
        if (!invoiceSync) {
          throw new Error(
            `Invoice sync record not found for QB invoice: ${record.qbInvoiceId}`,
          );
        }
      }

      // Verify customer still exists for this work order
      const customerId = await this.deps.resolvers.findCustomerByWorkOrder(
        record.workOrderId,
      );
      if (!customerId) {
        throw new Error(
          `Customer not found for work order: ${record.workOrderId}`,
        );
      }

      // Payment verified — mark as synced
      assertTransitionAllowed(
        inProgress.state,
        PaymentSyncState.SYNCED,
        PaymentSyncRecordDesign.lifecycle,
      );

      const synced: PaymentSyncRecord = {
        ...inProgress,
        state: PaymentSyncState.SYNCED,
        updatedAt: new Date().toISOString(),
      };
      await this.deps.queries.save(synced);
      await this.emitEvent(
        recordId,
        { workOrderId: synced.workOrderId, amountCents: synced.amountCents },
        'payment_sync.completed',
        context,
      );
      return synced;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';

      assertTransitionAllowed(
        inProgress.state,
        PaymentSyncState.FAILED,
        PaymentSyncRecordDesign.lifecycle,
      );

      const failed: PaymentSyncRecord = {
        ...inProgress,
        state: PaymentSyncState.FAILED,
        errorMessage,
        updatedAt: new Date().toISOString(),
      };
      await this.deps.queries.save(failed);
      await this.emitEvent(
        recordId,
        { errorMessage, attemptCount: failed.attemptCount },
        'payment_sync.failed',
        context,
      );
      return failed;
    }
  }

  /**
   * Retry a FAILED payment sync — transitions FAILED → IN_PROGRESS.
   * Only allowed from FAILED state.
   */
  async retryPayment(
    recordId: string,
    context: PaymentSyncCommandContext,
  ): Promise<PaymentSyncRecord> {
    const record = await this.requireRecord(recordId);

    if (record.state !== PaymentSyncState.FAILED) {
      throw new InvariantViolationError(
        `Cannot retry payment from state ${record.state}; must be FAILED`,
      );
    }

    assertTransitionAllowed(
      record.state,
      PaymentSyncState.IN_PROGRESS,
      PaymentSyncRecordDesign.lifecycle,
    );

    const updated: PaymentSyncRecord = {
      ...record,
      state: PaymentSyncState.IN_PROGRESS,
      attemptCount: record.attemptCount + 1,
      lastAttemptAt: new Date().toISOString(),
      errorMessage: undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.deps.queries.save(updated);
    await this.emitEvent(
      recordId,
      { before: record.state, after: updated.state },
      'payment_sync.started',
      context,
    );
    return updated;
  }

  async listByState(state: PaymentSyncState): Promise<PaymentSyncRecord[]> {
    return this.deps.queries.listByState(state);
  }

  async getRecord(
    recordId: string,
  ): Promise<PaymentSyncRecord | undefined> {
    return this.deps.queries.findById(recordId);
  }

  private async requireRecord(
    recordId: string,
  ): Promise<PaymentSyncRecord> {
    const record = await this.deps.queries.findById(recordId);
    if (!record) {
      throw new InvariantViolationError(
        `PaymentSyncRecord not found: ${recordId}`,
      );
    }
    return record;
  }

  private async emitEvent(
    recordId: string,
    metadata: unknown,
    eventName:
      | 'payment_sync.started'
      | 'payment_sync.completed'
      | 'payment_sync.failed',
    context: PaymentSyncCommandContext,
  ): Promise<void> {
    const auditAction =
      eventName === 'payment_sync.failed'
        ? AUDIT_POINTS.paymentSyncFail
        : eventName === 'payment_sync.completed'
          ? AUDIT_POINTS.paymentSyncComplete
          : AUDIT_POINTS.paymentSyncStart;

    await this.deps.audit.record({
      actorId: context.actorId,
      action: auditAction,
      entityType: 'PaymentSyncRecord',
      entityId: recordId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString(),
    });

    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload: metadata,
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
    this.deps.observability.metric('payment_sync.transition', 1, context);
  }
}
