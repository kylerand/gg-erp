import type {
  PrismaClient,
  Manufacturer as PrismaManufacturer,
  ManufacturerState,
} from '@prisma/client';

export interface ManufacturerRecord {
  id: string;
  manufacturerCode: string;
  manufacturerName: string;
  manufacturerState: ManufacturerState;
  website?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface ManufacturerRepository {
  findById(id: string): Promise<ManufacturerRecord | undefined>;
  findByCode(manufacturerCode: string): Promise<ManufacturerRecord | undefined>;
  findByName(manufacturerName: string): Promise<ManufacturerRecord | undefined>;
  list(manufacturerState?: ManufacturerState): Promise<ManufacturerRecord[]>;
  save(record: ManufacturerRecord): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export class InMemoryManufacturerRepository implements ManufacturerRepository {
  private readonly records = new Map<string, ManufacturerRecord>();

  async findById(id: string): Promise<ManufacturerRecord | undefined> {
    return this.records.get(id);
  }

  async findByCode(manufacturerCode: string): Promise<ManufacturerRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.manufacturerCode.toLowerCase() === manufacturerCode.toLowerCase() && !r.deletedAt,
    );
  }

  async findByName(manufacturerName: string): Promise<ManufacturerRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.manufacturerName.toLowerCase() === manufacturerName.toLowerCase() && !r.deletedAt,
    );
  }

  async list(manufacturerState?: ManufacturerState): Promise<ManufacturerRecord[]> {
    return [...this.records.values()]
      .filter((r) => !r.deletedAt && (manufacturerState ? r.manufacturerState === manufacturerState : true))
      .sort((a, b) => a.manufacturerName.localeCompare(b.manufacturerName));
  }

  async save(record: ManufacturerRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async softDelete(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, deletedAt: new Date().toISOString() });
  }
}

export class PrismaManufacturerRepository implements ManufacturerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ManufacturerRecord | undefined> {
    const r = await this.prisma.manufacturer.findUnique({ where: { id } });
    return r ? toManufacturerRecord(r) : undefined;
  }

  async findByCode(manufacturerCode: string): Promise<ManufacturerRecord | undefined> {
    const r = await this.prisma.manufacturer.findFirst({
      where: {
        manufacturerCode: { equals: manufacturerCode, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    return r ? toManufacturerRecord(r) : undefined;
  }

  async findByName(manufacturerName: string): Promise<ManufacturerRecord | undefined> {
    const r = await this.prisma.manufacturer.findFirst({
      where: {
        manufacturerName: { equals: manufacturerName, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    return r ? toManufacturerRecord(r) : undefined;
  }

  async list(manufacturerState?: ManufacturerState): Promise<ManufacturerRecord[]> {
    const records = await this.prisma.manufacturer.findMany({
      where: {
        deletedAt: null,
        ...(manufacturerState ? { manufacturerState } : {}),
      },
      orderBy: [{ manufacturerName: 'asc' }],
    });
    return records.map(toManufacturerRecord);
  }

  async save(record: ManufacturerRecord): Promise<void> {
    const data = {
      manufacturerCode: record.manufacturerCode,
      manufacturerName: record.manufacturerName,
      manufacturerState: record.manufacturerState,
      website: record.website ?? null,
      notes: record.notes ?? null,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.manufacturer.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.manufacturer.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }
}

function toManufacturerRecord(r: PrismaManufacturer): ManufacturerRecord {
  return {
    id: r.id,
    manufacturerCode: r.manufacturerCode,
    manufacturerName: r.manufacturerName,
    manufacturerState: r.manufacturerState,
    website: r.website ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
