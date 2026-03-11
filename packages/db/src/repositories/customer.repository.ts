import type {
  PrismaClient,
  Customer as PrismaCustomer,
  CustomerLifecycleState,
} from '@prisma/client';

export interface CustomerRecord {
  id: string;
  state: CustomerLifecycleState;
  externalReference?: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  preferredContactMethod: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  version: number;
}

export interface ListCustomersInput {
  state?: CustomerLifecycleState;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | undefined>;
  findByEmail(email: string): Promise<CustomerRecord | undefined>;
  findByExternalRef(ref: string): Promise<CustomerRecord | undefined>;
  list(input?: ListCustomersInput): Promise<CustomerRecord[]>;
  save(record: CustomerRecord): Promise<void>;
}

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly records = new Map<string, CustomerRecord>();

  async findById(id: string): Promise<CustomerRecord | undefined> {
    return this.records.get(id);
  }

  async findByEmail(email: string): Promise<CustomerRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.email.toLowerCase() === email.toLowerCase() && r.state !== 'ARCHIVED',
    );
  }

  async findByExternalRef(ref: string): Promise<CustomerRecord | undefined> {
    return [...this.records.values()].find((r) => r.externalReference === ref);
  }

  async list(input: ListCustomersInput = {}): Promise<CustomerRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    let results = [...this.records.values()];

    if (input.state) results = results.filter((r) => r.state === input.state);
    if (input.search) {
      const q = input.search.toLowerCase();
      results = results.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.companyName?.toLowerCase().includes(q),
      );
    }

    return results
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);
  }

  async save(record: CustomerRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CustomerRecord | undefined> {
    const r = await this.prisma.customer.findUnique({ where: { id } });
    return r ? toCustomerRecord(r) : undefined;
  }

  async findByEmail(email: string): Promise<CustomerRecord | undefined> {
    const r = await this.prisma.customer.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        state: { not: 'ARCHIVED' },
      },
    });
    return r ? toCustomerRecord(r) : undefined;
  }

  async findByExternalRef(ref: string): Promise<CustomerRecord | undefined> {
    const r = await this.prisma.customer.findFirst({
      where: { externalReference: ref },
    });
    return r ? toCustomerRecord(r) : undefined;
  }

  async list(input: ListCustomersInput = {}): Promise<CustomerRecord[]> {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;

    const records = await this.prisma.customer.findMany({
      where: {
        ...(input.state ? { state: input.state } : {}),
        ...(input.search
          ? {
              OR: [
                { fullName: { contains: input.search, mode: 'insensitive' } },
                { email: { contains: input.search, mode: 'insensitive' } },
                { companyName: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });

    return records.map(toCustomerRecord);
  }

  async save(record: CustomerRecord): Promise<void> {
    const data = {
      state: record.state,
      externalReference: record.externalReference ?? null,
      fullName: record.fullName,
      companyName: record.companyName ?? null,
      email: record.email,
      phone: record.phone ?? null,
      billingAddress: record.billingAddress ?? null,
      shippingAddress: record.shippingAddress ?? null,
      preferredContactMethod: record.preferredContactMethod,
      updatedAt: new Date(record.updatedAt),
      archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
      version: record.version,
    };

    await this.prisma.customer.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }
}

function toCustomerRecord(r: PrismaCustomer): CustomerRecord {
  return {
    id: r.id,
    state: r.state,
    externalReference: r.externalReference ?? undefined,
    fullName: r.fullName,
    companyName: r.companyName ?? undefined,
    email: r.email,
    phone: r.phone ?? undefined,
    billingAddress: r.billingAddress ?? undefined,
    shippingAddress: r.shippingAddress ?? undefined,
    preferredContactMethod: r.preferredContactMethod,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt?.toISOString(),
    version: r.version,
  };
}
