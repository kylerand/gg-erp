import type {
  PrismaClient,
  Part as PrismaPart,
  PartState,
} from '@prisma/client';

export interface PartRecord {
  id: string;
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  partState: PartState;
  reorderPoint: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface ListPartsInput {
  partState?: PartState;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PartRepository {
  findById(id: string): Promise<PartRecord | undefined>;
  findBySku(sku: string): Promise<PartRecord | undefined>;
  list(input?: ListPartsInput): Promise<PartRecord[]>;
  save(record: PartRecord): Promise<void>;
  softDelete(id: string, deletedByUserId?: string): Promise<void>;
}

export class InMemoryPartRepository implements PartRepository {
  private readonly records = new Map<string, PartRecord>();

  async findById(id: string): Promise<PartRecord | undefined> {
    return this.records.get(id);
  }

  async findBySku(sku: string): Promise<PartRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.sku === sku && !r.deletedAt,
    );
  }

  async list(input: ListPartsInput = {}): Promise<PartRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    let results = [...this.records.values()].filter((r) => !r.deletedAt);

    if (input.partState) {
      results = results.filter((r) => r.partState === input.partState);
    }
    if (input.search) {
      const q = input.search.toLowerCase();
      results = results.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
      );
    }

    return results
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .slice(offset, offset + limit);
  }

  async save(record: PartRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async softDelete(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record) {
      this.records.set(id, { ...record, deletedAt: new Date().toISOString() });
    }
  }
}

export class PrismaPartRepository implements PartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<PartRecord | undefined> {
    const r = await this.prisma.part.findUnique({ where: { id } });
    return r ? toPartRecord(r) : undefined;
  }

  async findBySku(sku: string): Promise<PartRecord | undefined> {
    const r = await this.prisma.part.findFirst({
      where: { sku, deletedAt: null },
    });
    return r ? toPartRecord(r) : undefined;
  }

  async list(input: ListPartsInput = {}): Promise<PartRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;

    const records = await this.prisma.part.findMany({
      where: {
        deletedAt: null,
        ...(input.partState ? { partState: input.partState } : {}),
        ...(input.search
          ? {
              OR: [
                { sku: { contains: input.search, mode: 'insensitive' } },
                { name: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ sku: 'asc' }],
      take: limit,
      skip: offset,
    });

    return records.map(toPartRecord);
  }

  async save(record: PartRecord): Promise<void> {
    const data = {
      sku: record.sku,
      name: record.name,
      description: record.description ?? null,
      unitOfMeasure: record.unitOfMeasure,
      partState: record.partState,
      reorderPoint: record.reorderPoint,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.part.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        ...data,
        createdAt: new Date(record.createdAt),
      },
      update: data,
    });
  }

  async softDelete(id: string, _deletedByUserId?: string): Promise<void> {
    await this.prisma.part.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }
}

function toPartRecord(r: PrismaPart): PartRecord {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
