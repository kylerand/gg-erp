import { PrismaClient, ReconciliationStatus as PrismaReconciliationStatus } from '@prisma/client';
import type {
  ReconciliationRun as PrismaReconciliationRun,
  ReconciliationRecord as PrismaReconciliationRecord,
} from '@prisma/client';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export enum ReconciliationStatus {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  MISMATCH = 'MISMATCH',
  RESOLVED = 'RESOLVED',
  SKIPPED = 'SKIPPED',
}

export interface ReconciliationRunRecord {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  totalRecords: number;
  matchedCount: number;
  mismatchCount: number;
  errorCount: number;
  triggeredBy?: string;
  createdAt: string;
}

export interface ReconciliationRecordItem {
  id: string;
  reconciliationType: string;
  erpRecordId: string;
  qbRecordId?: string;
  status: ReconciliationStatus;
  erpAmountCents?: number;
  qbAmountCents?: number;
  discrepancy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  notes?: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationCommandContext
  extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface ReconciliationServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
  queries: ReconciliationQueries;
  syncQueries: ReconciliationSyncQueries;
}

export interface RunStats {
  totalRecords: number;
  matchedCount: number;
  mismatchCount: number;
  errorCount: number;
}

export interface CreateRecordInput {
  reconciliationType: string;
  erpRecordId: string;
  qbRecordId?: string;
  status: ReconciliationStatus;
  erpAmountCents?: number;
  qbAmountCents?: number;
  discrepancy?: string;
  runId: string;
}

/** Represents a synced invoice for reconciliation comparison. */
export interface SyncedInvoiceRecord {
  id: string;
  invoiceNumber: string;
  externalReference?: string;
}

/** Represents a synced payment for reconciliation comparison. */
export interface SyncedPaymentRecord {
  id: string;
  qbPaymentId?: string;
  amountCents: number;
}

// ─── Prisma singleton ──────────────────────────────────────────────────────────

let reconciliationPrisma: PrismaClient | undefined;

function getReconciliationPrisma(): PrismaClient {
  reconciliationPrisma ??= new PrismaClient();
  return reconciliationPrisma;
}

// ─── Domain ↔ Prisma mapping ───────────────────────────────────────────────────

function toRunDomain(r: PrismaReconciliationRun): ReconciliationRunRecord {
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    status: r.status,
    totalRecords: r.totalRecords,
    matchedCount: r.matchedCount,
    mismatchCount: r.mismatchCount,
    errorCount: r.errorCount,
    triggeredBy: r.triggeredBy ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

function toRecordDomain(r: PrismaReconciliationRecord): ReconciliationRecordItem {
  return {
    id: r.id,
    reconciliationType: r.reconciliationType,
    erpRecordId: r.erpRecordId,
    qbRecordId: r.qbRecordId ?? undefined,
    status: r.status as string as ReconciliationStatus,
    erpAmountCents: r.erpAmountCents ?? undefined,
    qbAmountCents: r.qbAmountCents ?? undefined,
    discrepancy: r.discrepancy ?? undefined,
    resolvedAt: r.resolvedAt?.toISOString(),
    resolvedBy: r.resolvedBy ?? undefined,
    notes: r.notes ?? undefined,
    runId: r.runId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Exported query object (mockable in tests) ─────────────────────────────────

export const reconciliationQueries = {
  async createRun(triggeredBy?: string): Promise<ReconciliationRunRecord> {
    const r = await getReconciliationPrisma().reconciliationRun.create({
      data: {
        status: 'RUNNING',
        triggeredBy: triggeredBy ?? null,
      },
    });
    return toRunDomain(r);
  },

  async completeRun(runId: string, stats: RunStats): Promise<ReconciliationRunRecord> {
    const r = await getReconciliationPrisma().reconciliationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalRecords: stats.totalRecords,
        matchedCount: stats.matchedCount,
        mismatchCount: stats.mismatchCount,
        errorCount: stats.errorCount,
      },
    });
    return toRunDomain(r);
  },

  async failRun(runId: string, error: string): Promise<ReconciliationRunRecord> {
    const r = await getReconciliationPrisma().reconciliationRun.update({
      where: { id: runId },
      data: {
        status: `FAILED: ${error}`,
        completedAt: new Date(),
      },
    });
    return toRunDomain(r);
  },

  async createRecord(data: CreateRecordInput): Promise<ReconciliationRecordItem> {
    const r = await getReconciliationPrisma().reconciliationRecord.create({
      data: {
        reconciliationType: data.reconciliationType,
        erpRecordId: data.erpRecordId,
        qbRecordId: data.qbRecordId ?? null,
        status: data.status as string as PrismaReconciliationStatus,
        erpAmountCents: data.erpAmountCents ?? null,
        qbAmountCents: data.qbAmountCents ?? null,
        discrepancy: data.discrepancy ?? null,
        runId: data.runId,
      },
    });
    return toRecordDomain(r);
  },

  async listRecords(
    runId: string,
    status?: ReconciliationStatus,
  ): Promise<ReconciliationRecordItem[]> {
    const where: Record<string, unknown> = { runId };
    if (status) {
      where.status = status as string as PrismaReconciliationStatus;
    }
    const records = await getReconciliationPrisma().reconciliationRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toRecordDomain);
  },

  async updateRecordStatus(
    id: string,
    status: ReconciliationStatus,
    notes?: string,
  ): Promise<ReconciliationRecordItem> {
    const data: Record<string, unknown> = {
      status: status as string as PrismaReconciliationStatus,
      updatedAt: new Date(),
    };
    if (notes !== undefined) {
      data.notes = notes;
    }
    if (status === ReconciliationStatus.RESOLVED) {
      data.resolvedAt = new Date();
    }
    const r = await getReconciliationPrisma().reconciliationRecord.update({
      where: { id },
      data,
    });
    return toRecordDomain(r);
  },

  async getLatestRun(): Promise<ReconciliationRunRecord | undefined> {
    const r = await getReconciliationPrisma().reconciliationRun.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return r ? toRunDomain(r) : undefined;
  },

  async getRun(runId: string): Promise<ReconciliationRunRecord | undefined> {
    const r = await getReconciliationPrisma().reconciliationRun.findUnique({
      where: { id: runId },
    });
    return r ? toRunDomain(r) : undefined;
  },

  async listRuns(limit = 50, offset = 0): Promise<ReconciliationRunRecord[]> {
    const runs = await getReconciliationPrisma().reconciliationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return runs.map(toRunDomain);
  },

  async getRecordById(id: string): Promise<ReconciliationRecordItem | undefined> {
    const r = await getReconciliationPrisma().reconciliationRecord.findUnique({
      where: { id },
    });
    return r ? toRecordDomain(r) : undefined;
  },
};

export type ReconciliationQueries = typeof reconciliationQueries;

// ─── Sync queries for reading invoice/payment data during reconciliation ────

export const reconciliationSyncQueries = {
  async listSyncedInvoices(): Promise<SyncedInvoiceRecord[]> {
    const records = await getReconciliationPrisma().invoiceSyncRecord.findMany({
      where: { state: 'SYNCED' },
      select: { id: true, invoiceNumber: true, externalReference: true },
    });
    return records.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      externalReference: r.externalReference ?? undefined,
    }));
  },

  async listSyncedPayments(): Promise<SyncedPaymentRecord[]> {
    const records = await getReconciliationPrisma().paymentSyncRecord.findMany({
      where: { state: 'SYNCED' },
      select: { id: true, qbPaymentId: true, amountCents: true },
    });
    return records.map((r) => ({
      id: r.id,
      qbPaymentId: r.qbPaymentId ?? undefined,
      amountCents: r.amountCents,
    }));
  },
};

export type ReconciliationSyncQueries = typeof reconciliationSyncQueries;

// ─── Service ────────────────────────────────────────────────────────────────────

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationServiceDeps) {}

  async runReconciliation(
    context: ReconciliationCommandContext,
  ): Promise<ReconciliationRunRecord> {
    const run = await this.deps.queries.createRun(context.actorId);
    const stats: RunStats = {
      totalRecords: 0,
      matchedCount: 0,
      mismatchCount: 0,
      errorCount: 0,
    };

    try {
      // Reconcile synced invoices
      const invoices = await this.deps.syncQueries.listSyncedInvoices();
      for (const invoice of invoices) {
        stats.totalRecords++;
        try {
          // Invoice reconciliation: check that ERP record has a matching QB reference
          const hasQbReference = !!invoice.externalReference;
          const status = hasQbReference
            ? ReconciliationStatus.MATCHED
            : ReconciliationStatus.MISMATCH;

          if (status === ReconciliationStatus.MATCHED) {
            stats.matchedCount++;
          } else {
            stats.mismatchCount++;
          }

          await this.deps.queries.createRecord({
            reconciliationType: 'INVOICE',
            erpRecordId: invoice.id,
            qbRecordId: invoice.externalReference,
            status,
            discrepancy: hasQbReference
              ? undefined
              : 'Invoice synced but no QB external reference found',
            runId: run.id,
          });
        } catch {
          stats.errorCount++;
        }
      }

      // Reconcile synced payments
      const payments = await this.deps.syncQueries.listSyncedPayments();
      for (const payment of payments) {
        stats.totalRecords++;
        try {
          const hasQbPayment = !!payment.qbPaymentId;
          // Payment reconciliation: check QB payment exists and amounts can be compared
          const status = hasQbPayment
            ? ReconciliationStatus.MATCHED
            : ReconciliationStatus.MISMATCH;

          if (status === ReconciliationStatus.MATCHED) {
            stats.matchedCount++;
          } else {
            stats.mismatchCount++;
          }

          await this.deps.queries.createRecord({
            reconciliationType: 'PAYMENT',
            erpRecordId: payment.id,
            qbRecordId: payment.qbPaymentId,
            status,
            erpAmountCents: payment.amountCents,
            discrepancy: hasQbPayment
              ? undefined
              : 'Payment synced but no QB payment ID found',
            runId: run.id,
          });
        } catch {
          stats.errorCount++;
        }
      }

      const completedRun = await this.deps.queries.completeRun(run.id, stats);

      await this.emitEvent(
        run.id,
        { runId: run.id, ...stats },
        'reconciliation.completed',
        context,
      );

      return completedRun;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const failedRun = await this.deps.queries.failRun(run.id, errorMessage);

      await this.emitEvent(
        run.id,
        { runId: run.id, error: errorMessage },
        'reconciliation.failed',
        context,
      );

      return failedRun;
    }
  }

  async resolveRecord(
    recordId: string,
    resolution: { resolvedBy: string; notes: string },
    context: ReconciliationCommandContext,
  ): Promise<ReconciliationRecordItem> {
    const existing = await this.deps.queries.getRecordById(recordId);
    if (!existing) {
      throw new Error(`ReconciliationRecord not found: ${recordId}`);
    }

    if (existing.status !== ReconciliationStatus.MISMATCH) {
      throw new Error(
        `Can only resolve MISMATCH records. Current status: ${existing.status}`,
      );
    }

    const updated = await this.deps.queries.updateRecordStatus(
      recordId,
      ReconciliationStatus.RESOLVED,
      resolution.notes,
    );

    await this.emitEvent(
      recordId,
      { recordId, resolvedBy: resolution.resolvedBy, notes: resolution.notes },
      'reconciliation.record_resolved',
      context,
    );

    return updated;
  }

  async getRunSummary(
    runId: string,
  ): Promise<{ run: ReconciliationRunRecord; records: ReconciliationRecordItem[] } | undefined> {
    const run = await this.deps.queries.getRun(runId);
    if (!run) return undefined;

    const records = await this.deps.queries.listRecords(runId);
    return { run, records };
  }

  async listMismatches(runId?: string): Promise<ReconciliationRecordItem[]> {
    if (runId) {
      return this.deps.queries.listRecords(runId, ReconciliationStatus.MISMATCH);
    }
    // If no runId, get latest run and return its mismatches
    const latestRun = await this.deps.queries.getLatestRun();
    if (!latestRun) return [];
    return this.deps.queries.listRecords(latestRun.id, ReconciliationStatus.MISMATCH);
  }

  async listRuns(limit = 50, offset = 0): Promise<ReconciliationRunRecord[]> {
    return this.deps.queries.listRuns(limit, offset);
  }

  private async emitEvent(
    entityId: string,
    metadata: unknown,
    eventName:
      | 'reconciliation.completed'
      | 'reconciliation.failed'
      | 'reconciliation.record_resolved',
    context: ReconciliationCommandContext,
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId ?? 'system',
      action: AUDIT_POINTS.reconciliationRun,
      entityType: 'ReconciliationRun',
      entityId,
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
    this.deps.observability.metric('reconciliation.transition', 1, context);
  }
}
