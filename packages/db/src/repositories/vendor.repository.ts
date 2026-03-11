import type {
  PrismaClient,
  Vendor as PrismaVendor,
  VendorState,
} from '@prisma/client';

export interface VendorRecord {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorState: VendorState;
  email?: string;
  phone?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface VendorRepository {
  findById(id: string): Promise<VendorRecord | undefined>;
  findByCode(vendorCode: string): Promise<VendorRecord | undefined>;
  list(vendorState?: VendorState): Promise<VendorRecord[]>;
  save(record: VendorRecord): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export class InMemoryVendorRepository implements VendorRepository {
  private readonly records = new Map<string, VendorRecord>();

  async findById(id: string): Promise<VendorRecord | undefined> {
    return this.records.get(id);
  }

  async findByCode(vendorCode: string): Promise<VendorRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.vendorCode.toLowerCase() === vendorCode.toLowerCase() && !r.deletedAt,
    );
  }

  async list(vendorState?: VendorState): Promise<VendorRecord[]> {
    return [...this.records.values()]
      .filter((r) => !r.deletedAt && (vendorState ? r.vendorState === vendorState : true))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }

  async save(record: VendorRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async softDelete(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, deletedAt: new Date().toISOString() });
  }
}

export class PrismaVendorRepository implements VendorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<VendorRecord | undefined> {
    const r = await this.prisma.vendor.findUnique({ where: { id } });
    return r ? toVendorRecord(r) : undefined;
  }

  async findByCode(vendorCode: string): Promise<VendorRecord | undefined> {
    const r = await this.prisma.vendor.findFirst({
      where: {
        vendorCode: { equals: vendorCode, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    return r ? toVendorRecord(r) : undefined;
  }

  async list(vendorState?: VendorState): Promise<VendorRecord[]> {
    const records = await this.prisma.vendor.findMany({
      where: {
        deletedAt: null,
        ...(vendorState ? { vendorState } : {}),
      },
      orderBy: [{ vendorName: 'asc' }],
    });
    return records.map(toVendorRecord);
  }

  async save(record: VendorRecord): Promise<void> {
    const data = {
      vendorCode: record.vendorCode,
      vendorName: record.vendorName,
      vendorState: record.vendorState,
      email: record.email ?? null,
      phone: record.phone ?? null,
      leadTimeDays: record.leadTimeDays ?? null,
      paymentTerms: record.paymentTerms ?? null,
      notes: record.notes ?? null,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.vendor.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.vendor.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }
}

function toVendorRecord(r: PrismaVendor): VendorRecord {
  return {
    id: r.id,
    vendorCode: r.vendorCode,
    vendorName: r.vendorName,
    vendorState: r.vendorState,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    leadTimeDays: r.leadTimeDays ?? undefined,
    paymentTerms: r.paymentTerms ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
