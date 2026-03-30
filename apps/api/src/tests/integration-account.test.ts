import test from 'node:test';
import assert from 'node:assert/strict';
import type { IntegrationAccountStatus, IntegrationProvider, Prisma } from '@prisma/client';
import {
  queries,
  listAccounts,
  getAccount,
  createAccount,
  updateAccountStatus,
  deleteAccount,
  type IntegrationAccountRow,
} from '../contexts/accounting/integrationAccount.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<IntegrationAccountRow> = {}): IntegrationAccountRow {
  const now = new Date();
  return {
    id: 'acct-001',
    provider: 'QUICKBOOKS' as IntegrationProvider,
    accountKey: 'realm-123',
    displayName: 'QuickBooks (realm-123)',
    accountStatus: 'ACTIVE' as IntegrationAccountStatus,
    configuration: {},
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

/** Replace query functions with test stubs. Restores originals after test. */
function stubQueries(stubs: Partial<typeof queries>): () => void {
  const originals: Record<string, unknown> = {};
  for (const [key, fn] of Object.entries(stubs)) {
    originals[key] = (queries as Record<string, unknown>)[key];
    (queries as Record<string, unknown>)[key] = fn;
  }
  return () => {
    for (const [key, fn] of Object.entries(originals)) {
      (queries as Record<string, unknown>)[key] = fn;
    }
  };
}

// ─── listAccounts ─────────────────────────────────────────────────────────────

test('listAccounts returns all non-deleted accounts', async () => {
  const accounts = [makeAccount(), makeAccount({ id: 'acct-002', displayName: 'Second' })];
  const restore = stubQueries({
    findMany: async (_where: Prisma.IntegrationAccountWhereInput) => accounts,
  });

  const result = await listAccounts();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'acct-001');
  assert.equal(result[1].id, 'acct-002');

  restore();
});

test('listAccounts filters by provider', async () => {
  let capturedWhere: Prisma.IntegrationAccountWhereInput | undefined;
  const restore = stubQueries({
    findMany: async (where: Prisma.IntegrationAccountWhereInput) => {
      capturedWhere = where;
      return [];
    },
  });

  await listAccounts('QUICKBOOKS' as IntegrationProvider);
  assert.equal(capturedWhere?.provider, 'QUICKBOOKS');
  assert.equal(capturedWhere?.deletedAt, null);

  restore();
});

test('listAccounts without provider does not filter provider', async () => {
  let capturedWhere: Prisma.IntegrationAccountWhereInput | undefined;
  const restore = stubQueries({
    findMany: async (where: Prisma.IntegrationAccountWhereInput) => {
      capturedWhere = where;
      return [];
    },
  });

  await listAccounts();
  assert.equal(capturedWhere?.provider, undefined);
  assert.equal(capturedWhere?.deletedAt, null);

  restore();
});

// ─── getAccount ───────────────────────────────────────────────────────────────

test('getAccount returns account when found', async () => {
  const account = makeAccount();
  const restore = stubQueries({
    findUnique: async (_id: string) => account,
  });

  const result = await getAccount('acct-001');
  assert.ok(result);
  assert.equal(result.id, 'acct-001');

  restore();
});

test('getAccount returns null for non-existent account', async () => {
  const restore = stubQueries({
    findUnique: async (_id: string) => null,
  });

  const result = await getAccount('missing');
  assert.equal(result, null);

  restore();
});

test('getAccount returns null for soft-deleted account', async () => {
  const deleted = makeAccount({ deletedAt: new Date() });
  const restore = stubQueries({
    findUnique: async (_id: string) => deleted,
  });

  const result = await getAccount('acct-001');
  assert.equal(result, null);

  restore();
});

// ─── createAccount ────────────────────────────────────────────────────────────

test('createAccount creates with correct data', async () => {
  let capturedData: Prisma.IntegrationAccountCreateInput | undefined;
  const created = makeAccount();
  const restore = stubQueries({
    create: async (data: Prisma.IntegrationAccountCreateInput) => {
      capturedData = data;
      return created;
    },
  });

  const result = await createAccount({
    provider: 'QUICKBOOKS' as IntegrationProvider,
    accountKey: 'realm-123',
    displayName: 'QuickBooks (realm-123)',
  });

  assert.equal(result.id, 'acct-001');
  assert.equal(capturedData?.provider, 'QUICKBOOKS');
  assert.equal(capturedData?.accountKey, 'realm-123');
  assert.equal(capturedData?.displayName, 'QuickBooks (realm-123)');
  assert.deepEqual(capturedData?.configuration, {});

  restore();
});

test('createAccount passes custom configuration', async () => {
  let capturedData: Prisma.IntegrationAccountCreateInput | undefined;
  const restore = stubQueries({
    create: async (data: Prisma.IntegrationAccountCreateInput) => {
      capturedData = data;
      return makeAccount({ configuration: { sandbox: true } });
    },
  });

  await createAccount({
    provider: 'GENERIC' as IntegrationProvider,
    accountKey: 'key-1',
    displayName: 'Test',
    configuration: { sandbox: true },
  });

  assert.deepEqual(capturedData?.configuration, { sandbox: true });

  restore();
});

// ─── updateAccountStatus ──────────────────────────────────────────────────────

test('updateAccountStatus transitions ACTIVE → PAUSED', async () => {
  const account = makeAccount({ accountStatus: 'ACTIVE' as IntegrationAccountStatus });
  const updated = makeAccount({ accountStatus: 'PAUSED' as IntegrationAccountStatus });

  const restore = stubQueries({
    findUnique: async (_id: string) => account,
    update: async (_id: string, _data: Prisma.IntegrationAccountUpdateInput) => updated,
  });

  const result = await updateAccountStatus('acct-001', 'PAUSED' as IntegrationAccountStatus);
  assert.ok(result);
  assert.equal(result.accountStatus, 'PAUSED');

  restore();
});

test('updateAccountStatus transitions PAUSED → ACTIVE', async () => {
  const account = makeAccount({ accountStatus: 'PAUSED' as IntegrationAccountStatus });
  const updated = makeAccount({ accountStatus: 'ACTIVE' as IntegrationAccountStatus });

  const restore = stubQueries({
    findUnique: async (_id: string) => account,
    update: async (_id: string, _data: Prisma.IntegrationAccountUpdateInput) => updated,
  });

  const result = await updateAccountStatus('acct-001', 'ACTIVE' as IntegrationAccountStatus);
  assert.ok(result);
  assert.equal(result.accountStatus, 'ACTIVE');

  restore();
});

test('updateAccountStatus transitions to DISCONNECTED', async () => {
  const account = makeAccount();
  const updated = makeAccount({ accountStatus: 'DISCONNECTED' as IntegrationAccountStatus });

  const restore = stubQueries({
    findUnique: async (_id: string) => account,
    update: async (_id: string, _data: Prisma.IntegrationAccountUpdateInput) => updated,
  });

  const result = await updateAccountStatus('acct-001', 'DISCONNECTED' as IntegrationAccountStatus);
  assert.ok(result);
  assert.equal(result.accountStatus, 'DISCONNECTED');

  restore();
});

test('updateAccountStatus returns null for non-existent account', async () => {
  const restore = stubQueries({
    findUnique: async (_id: string) => null,
  });

  const result = await updateAccountStatus('missing', 'PAUSED' as IntegrationAccountStatus);
  assert.equal(result, null);

  restore();
});

test('updateAccountStatus returns null for soft-deleted account', async () => {
  const deleted = makeAccount({ deletedAt: new Date() });
  const restore = stubQueries({
    findUnique: async (_id: string) => deleted,
  });

  const result = await updateAccountStatus('acct-001', 'ACTIVE' as IntegrationAccountStatus);
  assert.equal(result, null);

  restore();
});

// ─── deleteAccount ────────────────────────────────────────────────────────────

test('deleteAccount soft-deletes by setting deletedAt and DISCONNECTED', async () => {
  const account = makeAccount();
  let capturedData: Prisma.IntegrationAccountUpdateInput | undefined;
  const deleted = makeAccount({
    deletedAt: new Date(),
    accountStatus: 'DISCONNECTED' as IntegrationAccountStatus,
  });

  const restore = stubQueries({
    findUnique: async (_id: string) => account,
    update: async (_id: string, data: Prisma.IntegrationAccountUpdateInput) => {
      capturedData = data;
      return deleted;
    },
  });

  const result = await deleteAccount('acct-001');
  assert.ok(result);
  assert.ok(result.deletedAt);
  assert.equal(result.accountStatus, 'DISCONNECTED');
  assert.ok(capturedData?.deletedAt);
  assert.equal(capturedData?.accountStatus, 'DISCONNECTED');

  restore();
});

test('deleteAccount returns null for non-existent account', async () => {
  const restore = stubQueries({
    findUnique: async (_id: string) => null,
  });

  const result = await deleteAccount('missing');
  assert.equal(result, null);

  restore();
});

test('deleteAccount returns null for already-deleted account', async () => {
  const deleted = makeAccount({ deletedAt: new Date() });
  const restore = stubQueries({
    findUnique: async (_id: string) => deleted,
  });

  const result = await deleteAccount('acct-001');
  assert.equal(result, null);

  restore();
});
