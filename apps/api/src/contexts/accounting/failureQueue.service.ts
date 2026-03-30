import { PrismaClient } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyncRecordType = 'invoice' | 'customer' | 'payment';

export interface FailedRecordSummary {
  id: string;
  type: SyncRecordType;
  errorCode?: string;
  errorMessage?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FailureSummary {
  invoice: number;
  customer: number;
  payment: number;
  total: number;
}

export interface RetryResult {
  id: string;
  type: SyncRecordType;
  success: boolean;
  message: string;
}

export interface FailureQueueCommandContext {
  correlationId: string;
  actorId?: string;
  module: string;
}

export interface FailureQueueServiceDeps {
  queries: FailureQueueQueries;
}

// ─── Prisma singleton ──────────────────────────────────────────────────────────

let failureQueuePrisma: PrismaClient | undefined;

function getFailureQueuePrisma(): PrismaClient {
  failureQueuePrisma ??= new PrismaClient();
  return failureQueuePrisma;
}

// ─── Exported query object (mockable in tests) ─────────────────────────────────

export const failureQueueQueries = {
  async listFailedInvoices(limit: number): Promise<FailedRecordSummary[]> {
    const records = await getFailureQueuePrisma().invoiceSyncRecord.findMany({
      where: { state: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return records.map((r) => ({
      id: r.id,
      type: 'invoice' as const,
      errorCode: r.lastErrorCode ?? undefined,
      errorMessage: r.lastErrorMessage ?? undefined,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  async listFailedCustomers(limit: number): Promise<FailedRecordSummary[]> {
    const records = await getFailureQueuePrisma().customerSyncRecord.findMany({
      where: { state: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return records.map((r) => ({
      id: r.id,
      type: 'customer' as const,
      errorCode: r.lastErrorCode ?? undefined,
      errorMessage: r.lastErrorMessage ?? undefined,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  async listFailedPayments(limit: number): Promise<FailedRecordSummary[]> {
    const records = await getFailureQueuePrisma().paymentSyncRecord.findMany({
      where: { state: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return records.map((r) => ({
      id: r.id,
      type: 'payment' as const,
      errorMessage: r.errorMessage ?? undefined,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  async countFailedInvoices(): Promise<number> {
    return getFailureQueuePrisma().invoiceSyncRecord.count({
      where: { state: 'FAILED' },
    });
  },

  async countFailedCustomers(): Promise<number> {
    return getFailureQueuePrisma().customerSyncRecord.count({
      where: { state: 'FAILED' },
    });
  },

  async countFailedPayments(): Promise<number> {
    return getFailureQueuePrisma().paymentSyncRecord.count({
      where: { state: 'FAILED' },
    });
  },

  async resetInvoiceToRetry(id: string): Promise<boolean> {
    try {
      await getFailureQueuePrisma().invoiceSyncRecord.update({
        where: { id },
        data: {
          state: 'PENDING',
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  },

  async resetCustomerToRetry(id: string): Promise<boolean> {
    try {
      await getFailureQueuePrisma().customerSyncRecord.update({
        where: { id },
        data: {
          state: 'PENDING',
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  },

  async resetPaymentToRetry(id: string): Promise<boolean> {
    try {
      await getFailureQueuePrisma().paymentSyncRecord.update({
        where: { id },
        data: {
          state: 'PENDING',
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  },
};

export type FailureQueueQueries = typeof failureQueueQueries;

// ─── Service ────────────────────────────────────────────────────────────────────

export class FailureQueueService {
  constructor(private readonly deps: FailureQueueServiceDeps) {}

  async listFailedRecords(
    type?: SyncRecordType,
    limit = 50,
  ): Promise<FailedRecordSummary[]> {
    const results: FailedRecordSummary[] = [];

    if (!type || type === 'invoice') {
      results.push(...await this.deps.queries.listFailedInvoices(limit));
    }
    if (!type || type === 'customer') {
      results.push(...await this.deps.queries.listFailedCustomers(limit));
    }
    if (!type || type === 'payment') {
      results.push(...await this.deps.queries.listFailedPayments(limit));
    }

    // Sort by updatedAt descending and cap at limit
    return results
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  async retryRecord(
    type: SyncRecordType,
    recordId: string,
    _context: FailureQueueCommandContext,
  ): Promise<RetryResult> {
    let success = false;

    switch (type) {
      case 'invoice':
        success = await this.deps.queries.resetInvoiceToRetry(recordId);
        break;
      case 'customer':
        success = await this.deps.queries.resetCustomerToRetry(recordId);
        break;
      case 'payment':
        success = await this.deps.queries.resetPaymentToRetry(recordId);
        break;
    }

    return {
      id: recordId,
      type,
      success,
      message: success
        ? `Record ${recordId} reset to PENDING for retry`
        : `Failed to reset record ${recordId}`,
    };
  }

  async retryAll(
    type?: SyncRecordType,
    context?: FailureQueueCommandContext,
  ): Promise<RetryResult[]> {
    const failedRecords = await this.listFailedRecords(type, 200);
    const results: RetryResult[] = [];

    const ctx = context ?? {
      correlationId: 'batch-retry',
      actorId: 'system',
      module: 'failure-queue',
    };

    for (const record of failedRecords) {
      const result = await this.retryRecord(record.type, record.id, ctx);
      results.push(result);
    }

    return results;
  }

  async getFailureSummary(): Promise<FailureSummary> {
    const [invoice, customer, payment] = await Promise.all([
      this.deps.queries.countFailedInvoices(),
      this.deps.queries.countFailedCustomers(),
      this.deps.queries.countFailedPayments(),
    ]);

    return {
      invoice,
      customer,
      payment,
      total: invoice + customer + payment,
    };
  }
}
