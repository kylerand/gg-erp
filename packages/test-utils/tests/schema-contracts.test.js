import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationArtifactsPromise = (async () => {
  const [canonical, prismaInit, identityAuthz] = await Promise.all([
    readFile(new URL('../../../apps/api/src/migrations/0002_canonical_erp_domain.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../packages/db/prisma/migrations/0001_init/migration.sql', import.meta.url), 'utf8'),
    readFile(
      new URL('../../../apps/api/src/migrations/0003_identity_authn_authz_rbac.sql', import.meta.url),
      'utf8'
    )
  ]);

  return { canonical, prismaInit, identityAuthz };
})();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTableDefinition(sql, tableName) {
  const pattern = new RegExp(
    `create table if not exists\\s+${escapeRegex(tableName)}\\s*\\((?<columns>[\\s\\S]*?)\\n\\);`,
    'i'
  );
  const match = sql.match(pattern);
  assert.ok(match?.groups?.columns, `Expected table ${tableName} to be defined in migration SQL`);
  return match.groups.columns;
}

test('uuid primary keys keep gen_random_uuid defaults', async () => {
  const { canonical, prismaInit } = await migrationArtifactsPromise;

  assert.match(canonical, /id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i);
  assert.match(prismaInit, /id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i);

  const canonicalMatches = canonical.match(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/gi) ?? [];
  assert.ok(canonicalMatches.length >= 30, 'Expected canonical migration to define many UUID PK defaults');
});

test('mutable core tables include created_at and updated_at timestamps', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const mutableTables = [
    'identity.users',
    'inventory.parts',
    'inventory.inventory_reservations',
    'work_orders.work_orders',
    'planning.planning_scenarios',
    'events.outbox_events'
  ];

  for (const tableName of mutableTables) {
    const definition = findTableDefinition(canonical, tableName);
    assert.match(
      definition,
      /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i,
      `Expected ${tableName} to include created_at timestamp`
    );
    assert.match(
      definition,
      /updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i,
      `Expected ${tableName} to include updated_at timestamp`
    );
  }
});

test('soft-delete tables preserve deleted_at metadata', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const softDeleteTables = [
    'identity.users',
    'identity.roles',
    'inventory.parts',
    'planning.planning_scenarios',
    'sop_ojt.sop_documents',
    'integrations.integration_accounts'
  ];

  for (const tableName of softDeleteTables) {
    const definition = findTableDefinition(canonical, tableName);
    assert.match(definition, /deleted_at\s+timestamptz/i, `Expected ${tableName} to include deleted_at`);
    assert.match(definition, /delete_reason\s+text/i, `Expected ${tableName} to include delete_reason`);
  }
});

test('optimistic locking version columns remain on mutable aggregates', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const versionedTables = [
    'identity.users',
    'inventory.parts',
    'inventory.inventory_reservations',
    'inventory.inventory_balances',
    'work_orders.work_orders',
    'planning.planning_scenarios',
    'events.outbox_events'
  ];

  for (const tableName of versionedTables) {
    const definition = findTableDefinition(canonical, tableName);
    assert.match(
      definition,
      /version\s+integer\s+not null\s+default\s+0\s+check\s+\(version\s+>=\s+0\)/i,
      `Expected ${tableName} to include optimistic locking version column`
    );
  }
});

test('inventory ledger remains immutable append-only', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const ledgerDefinition = findTableDefinition(canonical, 'inventory.inventory_ledger_entries');

  assert.match(ledgerDefinition, /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  assert.doesNotMatch(ledgerDefinition, /updated_at\s+timestamptz/i);
  assert.doesNotMatch(ledgerDefinition, /deleted_at\s+timestamptz/i);

  assert.match(
    canonical,
    /create or replace function\s+ops\.prevent_append_only_mutation\(\)[\s\S]*?raise exception 'Table %\.% is append-only; write a compensating record instead'/i
  );
  assert.match(
    canonical,
    /create trigger\s+trg_inventory_ledger_entries_immutable\s+before update or delete on inventory\.inventory_ledger_entries\s+for each row execute function ops\.prevent_append_only_mutation\(\);/i
  );
});

test('audit tables are present for traceability', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const auditTables = ['audit.audit_events', 'audit.entity_change_sets', 'audit.access_audit_events'];

  for (const tableName of auditTables) {
    findTableDefinition(canonical, tableName);
  }
});

test('outbox/event tables are present for asynchronous delivery', async () => {
  const { canonical } = await migrationArtifactsPromise;
  const outboxDefinition = findTableDefinition(canonical, 'events.outbox_events');

  assert.match(outboxDefinition, /publish_status\s+text\s+not null\s+default\s+'PENDING'/i);
  assert.match(outboxDefinition, /attempt_count\s+integer\s+not null\s+default\s+0/i);

  findTableDefinition(canonical, 'events.outbox_publish_attempts');
  findTableDefinition(canonical, 'events.event_consumer_inbox');
});

test('identity authz migration defines org/shop/team scope hierarchy tables', async () => {
  const { identityAuthz } = await migrationArtifactsPromise;
  const requiredTables = [
    'identity.organizations',
    'identity.shops',
    'identity.teams',
    'identity.role_scope_grants',
    'identity.user_scope_assignments'
  ];

  for (const tableName of requiredTables) {
    findTableDefinition(identityAuthz, tableName);
  }
});

test('identity authz migration enforces grant and assignment invariants', async () => {
  const { identityAuthz } = await migrationArtifactsPromise;
  const roleScopeGrantsDefinition = findTableDefinition(identityAuthz, 'identity.role_scope_grants');
  const userScopeAssignmentsDefinition = findTableDefinition(identityAuthz, 'identity.user_scope_assignments');

  assert.match(
    roleScopeGrantsDefinition,
    /scope_level\s+text\s+not null\s+check\s+\(scope_level in \('ORG', 'SHOP', 'TEAM'\)\)/i
  );
  assert.match(roleScopeGrantsDefinition, /constraint role_scope_grants_dimension_ck/i);
  assert.match(
    roleScopeGrantsDefinition,
    /foreign key \(shop_id, organization_id\)\s+references identity\.shops\(id, organization_id\)/i
  );
  assert.match(
    roleScopeGrantsDefinition,
    /foreign key \(team_id, shop_id, organization_id\)\s+references identity\.teams\(id, shop_id, organization_id\)/i
  );

  assert.match(
    userScopeAssignmentsDefinition,
    /assignment_status\s+text\s+not null\s+default\s+'ACTIVE'\s+check \(assignment_status in \('ACTIVE', 'REVOKED', 'EXPIRED'\)\)/i
  );
  assert.match(userScopeAssignmentsDefinition, /constraint user_scope_assignments_effective_window_ck/i);
  assert.match(
    userScopeAssignmentsDefinition,
    /check \(effective_to is null or effective_to > effective_from\)/i
  );

  assert.match(identityAuthz, /create unique index if not exists role_scope_grants_active_uk/i);
  assert.match(identityAuthz, /create unique index if not exists user_scope_assignments_active_uk/i);
});

test('identity authz migration remains coherent with canonical identity entities', async () => {
  const { canonical, identityAuthz } = await migrationArtifactsPromise;

  assert.match(canonical, /create table if not exists identity\.users/i);
  assert.match(canonical, /create table if not exists identity\.roles/i);
  assert.match(identityAuthz, /role_id uuid not null references identity\.roles\(id\) on delete cascade/i);
  assert.match(identityAuthz, /user_id uuid not null references identity\.users\(id\) on delete cascade/i);
});
