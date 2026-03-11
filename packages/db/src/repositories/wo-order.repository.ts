import type {
  PrismaClient,
  WoOrder as PrismaWoOrder,
  WoStatus,
} from '@prisma/client';

export interface WoOrderRecord {
  id: string;
  workOrderNumber: string;
  customerReference?: string;
  assetReference?: string;
  title: string;
  description?: string;
  status: WoStatus;
  priority: number;
  stockLocationId?: string;
  openedAt: string;
  dueAt?: string;
  completedAt?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ListWoOrdersInput {
  status?: WoStatus;
  stockLocationId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface WoOrderRepository {
  findById(id: string): Promise<WoOrderRecord | undefined>;
  findByNumber(workOrderNumber: string): Promise<WoOrderRecord | undefined>;
  list(input?: ListWoOrdersInput): Promise<WoOrderRecord[]>;
  save(record: WoOrderRecord): Promise<void>;
}

export class InMemoryWoOrderRepository implements WoOrderRepository {
  private readonly records = new Map<string, WoOrderRecord>();

  async findById(id: string): Promise<WoOrderRecord | undefined> {
    return this.records.get(id);
  }

  async findByNumber(workOrderNumber: string): Promise<WoOrderRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.workOrderNumber === workOrderNumber,
    );
  }

  async list(input: ListWoOrdersInput = {}): Promise<WoOrderRecord[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    let results = [...this.records.values()];

    if (input.status) results = results.filter((r) => r.status === input.status);
    if (input.stockLocationId) {
      results = results.filter((r) => r.stockLocationId === input.stockLocationId);
    }
    if (input.search) {
      const q = input.search.toLowerCase();
      results = results.filter(
        (r) =>
          r.workOrderNumber.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.customerReference?.toLowerCase().includes(q),
      );
    }

    return results
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);
  }

  async save(record: WoOrderRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaWoOrderRepository implements WoOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<WoOrderRecord | undefined> {
    const r = await this.prisma.woOrder.findUnique({ where: { id } });
    return r ? toWoOrderRecord(r) : undefined;
  }

  async findByNumber(workOrderNumber: string): Promise<WoOrderRecord | undefined> {
    const r = await this.prisma.woOrder.findUnique({ where: { workOrderNumber } });
    return r ? toWoOrderRecord(r) : undefined;
  }

  async list(input: ListWoOrdersInput = {}): Promise<WoOrderRecord[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const records = await this.prisma.woOrder.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.stockLocationId ? { stockLocationId: input.stockLocationId } : {}),
        ...(input.search
          ? {
              OR: [
                { workOrderNumber: { contains: input.search, mode: 'insensitive' } },
                { title: { contains: input.search, mode: 'insensitive' } },
                { customerReference: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });

    return records.map(toWoOrderRecord);
  }

  async save(record: WoOrderRecord): Promise<void> {
    const data = {
      customerReference: record.customerReference ?? null,
      assetReference: record.assetReference ?? null,
      title: record.title,
      description: record.description ?? null,
      status: record.status,
      priority: record.priority,
      stockLocationId: record.stockLocationId ?? null,
      dueAt: record.dueAt ? new Date(record.dueAt) : null,
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      updatedByUserId: record.updatedByUserId ?? null,
      correlationId: record.correlationId,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.woOrder.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        workOrderNumber: record.workOrderNumber,
        createdByUserId: record.createdByUserId,
        openedAt: new Date(record.openedAt),
        createdAt: new Date(record.createdAt),
        ...data,
      },
      update: data,
    });
  }
}

function toWoOrderRecord(r: PrismaWoOrder): WoOrderRecord {
  return {
    id: r.id,
    workOrderNumber: r.workOrderNumber,
    customerReference: r.customerReference ?? undefined,
    assetReference: r.assetReference ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status,
    priority: r.priority,
    stockLocationId: r.stockLocationId ?? undefined,
    openedAt: r.openedAt.toISOString(),
    dueAt: r.dueAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    createdByUserId: r.createdByUserId,
    updatedByUserId: r.updatedByUserId ?? undefined,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}
