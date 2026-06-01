import { randomUUID } from 'node:crypto';
import {
  Prisma,
  PrismaClient,
  InvoiceSyncState as PrismaInvoiceSyncState,
} from '@prisma/client';
import type { InvoiceSyncRecord as PrismaInvoiceSyncModel } from '@prisma/client';
import {
  InvariantViolationError,
  InvoiceSyncRecordDesign,
  InvoiceSyncState,
  type InvoiceSyncRecord,
  assertTransitionAllowed,
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface InvoiceSyncServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
  queries: InvoiceSyncQueries;
}

export interface InvoiceSyncQueries {
  findById(id: string): Promise<InvoiceSyncRecord | undefined>;
  findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceSyncRecord | undefined>;
  save(record: InvoiceSyncRecord, correlationId: string): Promise<void>;
  captureDocumentSnapshot?(record: InvoiceSyncRecord, correlationId: string): Promise<void>;
}

export interface CreateInvoiceSyncInput {
  invoiceNumber: string;
  workOrderId: string;
  provider: InvoiceSyncRecord['provider'];
}

// ─── Prisma singleton ──────────────────────────────────────────────────────────

let invoiceSyncPrisma: PrismaClient | undefined;

function getInvoiceSyncPrisma(): PrismaClient {
  invoiceSyncPrisma ??= new PrismaClient();
  return invoiceSyncPrisma;
}

// ─── Domain ↔ Prisma mapping ───────────────────────────────────────────────────

function toDomain(r: PrismaInvoiceSyncModel): InvoiceSyncRecord {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    workOrderId: r.workOrderId,
    provider: r.provider as InvoiceSyncRecord['provider'],
    state: r.state as string as InvoiceSyncState,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    syncedAt: r.syncedAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Exported query object (mockable in tests) ─────────────────────────────────

export const invoiceSyncQueries = {
  async findById(id: string): Promise<InvoiceSyncRecord | undefined> {
    const r = await getInvoiceSyncPrisma().invoiceSyncRecord.findUnique({ where: { id } });
    return r ? toDomain(r) : undefined;
  },

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceSyncRecord | undefined> {
    const r = await getInvoiceSyncPrisma().invoiceSyncRecord.findFirst({
      where: { invoiceNumber },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toDomain(r) : undefined;
  },

  async save(record: InvoiceSyncRecord, correlationId: string): Promise<void> {
    const data = {
      invoiceNumber: record.invoiceNumber,
      workOrderId: record.workOrderId,
      provider: record.provider,
      state: record.state as string as PrismaInvoiceSyncState,
      attemptCount: record.attemptCount,
      lastErrorCode: record.lastErrorCode ?? null,
      lastErrorMessage: record.lastErrorMessage ?? null,
      externalReference: record.externalReference ?? null,
      syncedAt: record.syncedAt ? new Date(record.syncedAt) : null,
      correlationId,
      updatedAt: new Date(record.updatedAt),
    };

    await getInvoiceSyncPrisma().invoiceSyncRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  },

  async captureDocumentSnapshot(
    record: InvoiceSyncRecord,
    correlationId: string,
  ): Promise<void> {
    const prisma = getInvoiceSyncPrisma();
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: record.workOrderId },
      select: { workOrderNumber: true },
    });
    const documentDate = record.syncedAt
      ? new Date(record.syncedAt)
      : new Date(record.updatedAt ?? record.createdAt);
    const documentStatus = invoiceDocumentStatusFromState(record.state);

    await prisma.accountingInvoiceDocumentSnapshot.create({
      data: {
        invoiceSyncId: record.id,
        workOrderId: record.workOrderId,
        customerId: null,
        provider: record.provider,
        documentNumber: record.invoiceNumber,
        externalReference: record.externalReference ?? null,
        documentStatus,
        documentDate,
        currencyCode: 'USD',
        amountCents: null,
        workOrderNumber: workOrder?.workOrderNumber ?? null,
        customerName: null,
        syncState: record.state,
        attemptCount: record.attemptCount,
        errorCode: record.lastErrorCode ?? null,
        errorMessage: record.lastErrorMessage ?? null,
        documentSummary: {
          invoiceNumber: record.invoiceNumber,
          workOrderNumber: workOrder?.workOrderNumber ?? null,
          status: documentStatus,
        } satisfies Prisma.InputJsonValue,
        documentPayload: {
          syncRecordId: record.id,
          state: record.state,
          externalReference: record.externalReference ?? null,
          errorCode: record.lastErrorCode ?? null,
          errorMessage: record.lastErrorMessage ?? null,
        } satisfies Prisma.InputJsonValue,
        capturedAt: new Date(record.updatedAt ?? record.createdAt),
        correlationId,
      },
    });
  },
} satisfies InvoiceSyncQueries;

function invoiceDocumentStatusFromState(state: InvoiceSyncState): string {
  if (state === InvoiceSyncState.SYNCED) return 'EXPORTED';
  if (state === InvoiceSyncState.FAILED || state === InvoiceSyncState.CANCELLED) {
    return 'NEEDS_REVIEW';
  }
  return 'QUEUED';
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class InvoiceSyncService {
  constructor(private readonly deps: InvoiceSyncServiceDeps) {}

  async createRecord(
    input: CreateInvoiceSyncInput,
    context: CommandContext,
  ): Promise<InvoiceSyncRecord> {
    const duplicate = await this.deps.queries.findByInvoiceNumber(input.invoiceNumber);
    if (duplicate) {
      throw new InvariantViolationError(
        `Invoice sync record already exists: ${input.invoiceNumber}`,
      );
    }

    const now = new Date().toISOString();
    const record: InvoiceSyncRecord = {
      id: randomUUID(),
      invoiceNumber: input.invoiceNumber,
      workOrderId: input.workOrderId,
      provider: input.provider,
      state: InvoiceSyncState.PENDING,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.queries.save(record, context.correlationId);
    await this.deps.queries.captureDocumentSnapshot?.(record, context.correlationId);
    await this.emitEvent(record.id, record, 'invoice_sync.started', context);
    return record;
  }

  async startSync(recordId: string, context: CommandContext): Promise<InvoiceSyncRecord> {
    const existing = await this.requireRecord(recordId);
    if (existing.state !== InvoiceSyncState.PENDING && existing.state !== InvoiceSyncState.FAILED) {
      throw new InvariantViolationError(
        `Cannot start sync from state ${existing.state}`,
      );
    }

    assertTransitionAllowed(
      existing.state,
      InvoiceSyncState.IN_PROGRESS,
      InvoiceSyncRecordDesign.lifecycle,
    );
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.IN_PROGRESS,
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date().toISOString(),
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    };
    await this.deps.queries.save(updated, context.correlationId);
    await this.deps.queries.captureDocumentSnapshot?.(updated, context.correlationId);
    const eventName =
      existing.state === InvoiceSyncState.FAILED
        ? 'invoice_sync.retried'
        : 'invoice_sync.started';
    await this.emitEvent(
      recordId,
      { before: existing.state, after: updated.state },
      eventName,
      context,
    );
    return updated;
  }

  async markSuccess(
    recordId: string,
    externalReference: string,
    context: CommandContext,
  ): Promise<InvoiceSyncRecord> {
    const existing = await this.requireRecord(recordId);
    assertTransitionAllowed(
      existing.state,
      InvoiceSyncState.SYNCED,
      InvoiceSyncRecordDesign.lifecycle,
    );
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.SYNCED,
      externalReference,
      syncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.deps.queries.save(updated, context.correlationId);
    await this.deps.queries.captureDocumentSnapshot?.(updated, context.correlationId);
    await this.emitEvent(recordId, { externalReference }, 'invoice_sync.succeeded', context);
    return updated;
  }

  async markFailure(
    recordId: string,
    errorCode: string,
    errorMessage: string,
    context: CommandContext,
  ): Promise<InvoiceSyncRecord> {
    const existing = await this.requireRecord(recordId);
    assertTransitionAllowed(
      existing.state,
      InvoiceSyncState.FAILED,
      InvoiceSyncRecordDesign.lifecycle,
    );
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.FAILED,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      updatedAt: new Date().toISOString(),
    };
    await this.deps.queries.save(updated, context.correlationId);
    await this.deps.queries.captureDocumentSnapshot?.(updated, context.correlationId);
    await this.emitEvent(
      recordId,
      { errorCode, errorMessage, attemptCount: updated.attemptCount },
      'invoice_sync.failed',
      context,
    );
    return updated;
  }

  async getRecord(recordId: string): Promise<InvoiceSyncRecord | undefined> {
    return this.deps.queries.findById(recordId);
  }

  private async requireRecord(recordId: string): Promise<InvoiceSyncRecord> {
    const record = await this.deps.queries.findById(recordId);
    if (!record) {
      throw new InvariantViolationError(`InvoiceSyncRecord not found: ${recordId}`);
    }
    return record;
  }

  private async emitEvent(
    recordId: string,
    metadata: unknown,
    eventName:
      | 'invoice_sync.started'
      | 'invoice_sync.succeeded'
      | 'invoice_sync.failed'
      | 'invoice_sync.retried',
    context: CommandContext,
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action:
        eventName === 'invoice_sync.failed'
          ? AUDIT_POINTS.invoiceSyncFail
          : eventName === 'invoice_sync.retried'
            ? AUDIT_POINTS.invoiceSyncRetry
            : AUDIT_POINTS.invoiceSyncStart,
      entityType: 'InvoiceSyncRecord',
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
    this.deps.observability.metric('invoice_sync.transition', 1, context);
  }
}
