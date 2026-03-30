/**
 * IntegrationAccount CRUD service.
 *
 * Manages integration account lifecycle: create, read, update status,
 * and soft-delete. All Prisma calls go through the `queries` object
 * so tests can swap in mocks without touching the database.
 */
import type { IntegrationAccountStatus, IntegrationProvider, Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IntegrationAccountRow {
  id: string;
  provider: IntegrationProvider;
  accountKey: string;
  displayName: string;
  accountStatus: IntegrationAccountStatus;
  configuration: Prisma.JsonValue;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface CreateAccountInput {
  provider: IntegrationProvider;
  accountKey: string;
  displayName: string;
  configuration?: Prisma.InputJsonValue;
}

// ─── Query layer (mockable) ───────────────────────────────────────────────────

const prisma = new PrismaClient();

export const queries = {
  findMany(where: Prisma.IntegrationAccountWhereInput): Promise<IntegrationAccountRow[]> {
    return prisma.integrationAccount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  },

  findUnique(id: string): Promise<IntegrationAccountRow | null> {
    return prisma.integrationAccount.findUnique({ where: { id } });
  },

  create(data: Prisma.IntegrationAccountCreateInput): Promise<IntegrationAccountRow> {
    return prisma.integrationAccount.create({ data });
  },

  update(
    id: string,
    data: Prisma.IntegrationAccountUpdateInput,
  ): Promise<IntegrationAccountRow> {
    return prisma.integrationAccount.update({ where: { id }, data });
  },
};

// ─── Service functions ────────────────────────────────────────────────────────

export async function listAccounts(
  provider?: IntegrationProvider,
): Promise<IntegrationAccountRow[]> {
  const where: Prisma.IntegrationAccountWhereInput = { deletedAt: null };
  if (provider) {
    where.provider = provider;
  }
  return queries.findMany(where);
}

export async function getAccount(id: string): Promise<IntegrationAccountRow | null> {
  const account = await queries.findUnique(id);
  if (account?.deletedAt) return null;
  return account;
}

export async function createAccount(input: CreateAccountInput): Promise<IntegrationAccountRow> {
  return queries.create({
    provider: input.provider,
    accountKey: input.accountKey,
    displayName: input.displayName,
    configuration: input.configuration ?? {},
  });
}

export async function updateAccountStatus(
  id: string,
  status: IntegrationAccountStatus,
): Promise<IntegrationAccountRow | null> {
  const existing = await queries.findUnique(id);
  if (!existing || existing.deletedAt) return null;

  return queries.update(id, {
    accountStatus: status,
    updatedAt: new Date(),
  });
}

export async function deleteAccount(id: string): Promise<IntegrationAccountRow | null> {
  const existing = await queries.findUnique(id);
  if (!existing || existing.deletedAt) return null;

  return queries.update(id, {
    deletedAt: new Date(),
    accountStatus: 'DISCONNECTED',
    updatedAt: new Date(),
  });
}
