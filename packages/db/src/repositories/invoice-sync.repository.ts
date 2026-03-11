import type {
  PrismaClient,
  InvoiceSyncRecord as PrismaInvoiceSyncRecord,
  InvoiceSyncState,
} from '@prisma/client';

export interface InvoiceSyncRecordRow {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: string;
  state: InvoiceSyncState;
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  externalReference?: string;
  syncedAt?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface InvoiceSyncRepository {
  findById(id: string): Promise<InvoiceSyncRecordRow | undefined>;
  findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceSyncRecordRow | undefined>;
  listByWorkOrder(workOrderId: string): Promise<InvoiceSyncRecordRow[]>;
  listByState(state: InvoiceSyncState, limit?: number): Promise<InvoiceSyncRecordRow[]>;
  save(record: InvoiceSyncRecordRow): Promise<void>;
}

export class InMemoryInvoiceSyncRepository implements InvoiceSyncRepository {
  private readonly records = new Map<string, InvoiceSyncRecordRow>();

  async findById(id: string): Promise<InvoiceSyncRecordRow | undefined> {
    return this.records.get(id);
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceSyncRecordRow | undefined> {
    return [...this.records.values()].find((r) => r.invoiceNumber === invoiceNumber);
  }

  async listByWorkOrder(workOrderId: string): Promise<InvoiceSyncRecordRow[]> {
    return [...this.records.values()].filter((r) => r.workOrderId === workOrderId);
  }

  async listByState(state: InvoiceSyncState, limit = 50): Promise<InvoiceSyncRecordRow[]> {
    return [...this.records.values()]
      .filter((r) => r.state === state)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  async save(record: InvoiceSyncRecordRow): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaInvoiceSyncRepository implements InvoiceSyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<InvoiceSyncRecordRow | undefined> {
    const r = await this.prisma.invoiceSyncRecord.findUnique({ where: { id } });
    return r ? toRow(r) : undefined;
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceSyncRecordRow | undefined> {
    const r = await this.prisma.invoiceSyncRecord.findFirst({
      where: { invoiceNumber },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toRow(r) : undefined;
  }

  async listByWorkOrder(workOrderId: string): Promise<InvoiceSyncRecordRow[]> {
    const records = await this.prisma.invoiceSyncRecord.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toRow);
  }

  async listByState(state: InvoiceSyncState, limit = 50): Promise<InvoiceSyncRecordRow[]> {
    const records = await this.prisma.invoiceSyncRecord.findMany({
      where: { state },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return records.map(toRow);
  }

  async save(record: InvoiceSyncRecordRow): Promise<void> {
    const data = {
      invoiceNumber: record.invoiceNumber,
      workOrderId: record.workOrderId,
      provider: record.provider,
      state: record.state,
      attemptCount: record.attemptCount,
      lastErrorCode: record.lastErrorCode ?? null,
      lastErrorMessage: record.lastErrorMessage ?? null,
      externalReference: record.externalReference ?? null,
      syncedAt: record.syncedAt ? new Date(record.syncedAt) : null,
      correlationId: record.correlationId,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.invoiceSyncRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }
}

function toRow(r: PrismaInvoiceSyncRecord): InvoiceSyncRecordRow {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    workOrderId: r.workOrderId,
    provider: r.provider,
    state: r.state,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    syncedAt: r.syncedAt?.toISOString(),
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}
