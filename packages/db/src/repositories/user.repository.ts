import type {
  PrismaClient,
  User as PrismaUser,
  UserStatus,
} from '@prisma/client';

export interface UserRecord {
  id: string;
  cognitoSubject: string;
  email: string;
  displayName: string;
  status: UserStatus;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | undefined>;
  findByCognitoSubject(subject: string): Promise<UserRecord | undefined>;
  findByEmail(email: string): Promise<UserRecord | undefined>;
  save(record: UserRecord): Promise<void>;
  recordLogin(id: string): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly records = new Map<string, UserRecord>();

  async findById(id: string): Promise<UserRecord | undefined> {
    return this.records.get(id);
  }

  async findByCognitoSubject(subject: string): Promise<UserRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.cognitoSubject === subject && !r.deletedAt,
    );
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return [...this.records.values()].find(
      (r) => r.email.toLowerCase() === email.toLowerCase() && !r.deletedAt,
    );
  }

  async save(record: UserRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async recordLogin(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, lastLoginAt: new Date().toISOString() });
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<UserRecord | undefined> {
    const r = await this.prisma.user.findUnique({ where: { id } });
    return r ? toUserRecord(r) : undefined;
  }

  async findByCognitoSubject(subject: string): Promise<UserRecord | undefined> {
    const r = await this.prisma.user.findUnique({
      where: { cognitoSubject: subject },
    });
    return r ? toUserRecord(r) : undefined;
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const r = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    return r ? toUserRecord(r) : undefined;
  }

  async save(record: UserRecord): Promise<void> {
    const data = {
      cognitoSubject: record.cognitoSubject,
      email: record.email,
      displayName: record.displayName,
      status: record.status,
      updatedAt: new Date(record.updatedAt),
      version: record.version,
    };

    await this.prisma.user.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  }

  async recordLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }
}

function toUserRecord(r: PrismaUser): UserRecord {
  return {
    id: r.id,
    cognitoSubject: r.cognitoSubject,
    email: r.email,
    displayName: r.displayName,
    status: r.status,
    lastLoginAt: r.lastLoginAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString(),
    version: r.version,
  };
}
