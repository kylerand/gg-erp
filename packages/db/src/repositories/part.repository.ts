import type {
  PrismaClient,
  Part as PrismaPart,
  PartState,
  LifecycleLevel,
  PartCategory,
  InstallStage,
  PartColor,
} from '@prisma/client';

export interface PartRecord {
  id: string;
  sku: string;
  name: string;
  description?: string;
  variant?: string;
  color?: PartColor;
  category?: PartCategory;
  lifecycleLevel: LifecycleLevel;
  installStage?: InstallStage;
  manufacturerId?: string;
  manufacturerPartNumber?: string;
  defaultVendorId?: string;
  defaultLocationId?: string;
  producedFromPartId?: string;
  producedViaStage?: InstallStage;
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
  category?: PartCategory;
  installStage?: InstallStage;
  lifecycleLevel?: LifecycleLevel;
  manufacturerId?: string;
  defaultVendorId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PartChain {
  ancestors: PartRecord[];
  part: PartRecord;
  descendants: PartRecord[];
}

export interface PartRepository {
  findById(id: string): Promise<PartRecord | undefined>;
  findBySku(sku: string): Promise<PartRecord | undefined>;
  findByNameVariantLevel(
    name: string,
    variant: string | undefined,
    lifecycleLevel: LifecycleLevel,
  ): Promise<PartRecord | undefined>;
  list(input?: ListPartsInput): Promise<PartRecord[]>;
  count(input?: ListPartsInput): Promise<number>;
  save(record: PartRecord): Promise<void>;
  softDelete(id: string, deletedByUserId?: string): Promise<void>;
  getChain(partId: string): Promise<PartChain | undefined>;
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

  async findByNameVariantLevel(
    name: string,
    variant: string | undefined,
    lifecycleLevel: LifecycleLevel,
  ): Promise<PartRecord | undefined> {
    return [...this.records.values()].find(
      (r) =>
        !r.deletedAt &&
        r.name === name &&
        (r.variant ?? undefined) === (variant ?? undefined) &&
        r.lifecycleLevel === lifecycleLevel,
    );
  }

  async list(input: ListPartsInput = {}): Promise<PartRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const filtered = this.filtered(input);

    return filtered
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .slice(offset, offset + limit);
  }

  async count(input: ListPartsInput = {}): Promise<number> {
    return this.filtered(input).length;
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

  async getChain(partId: string): Promise<PartChain | undefined> {
    const part = this.records.get(partId);
    if (!part) return undefined;

    const ancestors: PartRecord[] = [];
    let cursor = part.producedFromPartId
      ? this.records.get(part.producedFromPartId)
      : undefined;
    while (cursor) {
      ancestors.unshift(cursor);
      cursor = cursor.producedFromPartId
        ? this.records.get(cursor.producedFromPartId)
        : undefined;
    }

    const descendants: PartRecord[] = [];
    const toVisit: PartRecord[] = [part];
    while (toVisit.length > 0) {
      const current = toVisit.shift()!;
      for (const candidate of this.records.values()) {
        if (candidate.producedFromPartId === current.id && !candidate.deletedAt) {
          descendants.push(candidate);
          toVisit.push(candidate);
        }
      }
    }

    return { ancestors, part, descendants };
  }

  private filtered(input: ListPartsInput): PartRecord[] {
    let results = [...this.records.values()].filter((r) => !r.deletedAt);

    if (input.partState) results = results.filter((r) => r.partState === input.partState);
    if (input.category) results = results.filter((r) => r.category === input.category);
    if (input.installStage) results = results.filter((r) => r.installStage === input.installStage);
    if (input.lifecycleLevel) results = results.filter((r) => r.lifecycleLevel === input.lifecycleLevel);
    if (input.manufacturerId) results = results.filter((r) => r.manufacturerId === input.manufacturerId);
    if (input.defaultVendorId) results = results.filter((r) => r.defaultVendorId === input.defaultVendorId);
    if (input.search) {
      const q = input.search.toLowerCase();
      results = results.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.variant?.toLowerCase().includes(q) ?? false) ||
          (r.manufacturerPartNumber?.toLowerCase().includes(q) ?? false),
      );
    }
    return results;
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

  async findByNameVariantLevel(
    name: string,
    variant: string | undefined,
    lifecycleLevel: LifecycleLevel,
  ): Promise<PartRecord | undefined> {
    const r = await this.prisma.part.findFirst({
      where: {
        name,
        variant: variant ?? null,
        lifecycleLevel,
        deletedAt: null,
      },
    });
    return r ? toPartRecord(r) : undefined;
  }

  async list(input: ListPartsInput = {}): Promise<PartRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;

    const records = await this.prisma.part.findMany({
      where: this.buildWhere(input),
      orderBy: [{ sku: 'asc' }],
      take: limit,
      skip: offset,
    });

    return records.map(toPartRecord);
  }

  async count(input: ListPartsInput = {}): Promise<number> {
    return this.prisma.part.count({ where: this.buildWhere(input) });
  }

  async save(record: PartRecord): Promise<void> {
    const data = {
      sku: record.sku,
      name: record.name,
      description: record.description ?? null,
      variant: record.variant ?? null,
      color: record.color ?? null,
      category: record.category ?? null,
      lifecycleLevel: record.lifecycleLevel,
      installStage: record.installStage ?? null,
      manufacturerId: record.manufacturerId ?? null,
      manufacturerPartNumber: record.manufacturerPartNumber ?? null,
      defaultVendorId: record.defaultVendorId ?? null,
      defaultLocationId: record.defaultLocationId ?? null,
      producedFromPartId: record.producedFromPartId ?? null,
      producedViaStage: record.producedViaStage ?? null,
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

  async getChain(partId: string): Promise<PartChain | undefined> {
    const part = await this.findById(partId);
    if (!part) return undefined;

    const ancestors: PartRecord[] = [];
    let cursor = part.producedFromPartId
      ? await this.findById(part.producedFromPartId)
      : undefined;
    while (cursor) {
      ancestors.unshift(cursor);
      cursor = cursor.producedFromPartId
        ? await this.findById(cursor.producedFromPartId)
        : undefined;
    }

    const descendants: PartRecord[] = [];
    const toVisit: PartRecord[] = [part];
    while (toVisit.length > 0) {
      const current = toVisit.shift()!;
      const children = await this.prisma.part.findMany({
        where: { producedFromPartId: current.id, deletedAt: null },
        orderBy: { lifecycleLevel: 'asc' },
      });
      for (const child of children) {
        const record = toPartRecord(child);
        descendants.push(record);
        toVisit.push(record);
      }
    }

    return { ancestors, part, descendants };
  }

  private buildWhere(input: ListPartsInput) {
    return {
      deletedAt: null,
      ...(input.partState ? { partState: input.partState } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.installStage ? { installStage: input.installStage } : {}),
      ...(input.lifecycleLevel ? { lifecycleLevel: input.lifecycleLevel } : {}),
      ...(input.manufacturerId ? { manufacturerId: input.manufacturerId } : {}),
      ...(input.defaultVendorId ? { defaultVendorId: input.defaultVendorId } : {}),
      ...(input.search
        ? {
            OR: [
              { sku: { contains: input.search, mode: 'insensitive' as const } },
              { name: { contains: input.search, mode: 'insensitive' as const } },
              { variant: { contains: input.search, mode: 'insensitive' as const } },
              { manufacturerPartNumber: { contains: input.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }
}

function toPartRecord(r: PrismaPart): PartRecord {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    variant: r.variant ?? undefined,
    color: r.color ?? undefined,
    category: r.category ?? undefined,
    lifecycleLevel: r.lifecycleLevel,
    installStage: r.installStage ?? undefined,
    manufacturerId: r.manufacturerId ?? undefined,
    manufacturerPartNumber: r.manufacturerPartNumber ?? undefined,
    defaultVendorId: r.defaultVendorId ?? undefined,
    defaultLocationId: r.defaultLocationId ?? undefined,
    producedFromPartId: r.producedFromPartId ?? undefined,
    producedViaStage: r.producedViaStage ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
