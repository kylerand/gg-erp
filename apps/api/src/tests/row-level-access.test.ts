import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import { InMemoryAuthzRepository } from '../contexts/identity/authz.repository.js';
import { AuthorizationGuardError } from '../middleware/authorize-permission.js';
import {
  evaluateRequestRowLevelAccess,
  requireRowLevelAccess
} from '../middleware/row-level-access.js';
import { createRequestContext } from '../middleware/request-context.js';

function buildPrincipal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'user-77',
    email: 'manager@example.com',
    roles: ['shop_manager'],
    groups: ['shop_manager'],
    orgId: 'org-1',
    shopId: 'shop-a',
    ...overrides
  };
}

test('row-level access allows matching shop scope', () => {
  const requestContext = createRequestContext({
    correlationId: 'row-scope-allow',
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  const decision = evaluateRequestRowLevelAccess({
    requestContext,
    rowScope: { orgId: 'org-1', shopId: 'shop-a' },
    minimumLevel: 'shop'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'ALLOW');
});

test('row-level access denies cross-shop access with deterministic reason', () => {
  const requestContext = createRequestContext({
    correlationId: 'row-scope-cross-shop',
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  const decision = evaluateRequestRowLevelAccess({
    requestContext,
    rowScope: { orgId: 'org-1', shopId: 'shop-b' },
    minimumLevel: 'shop'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DENY_SCOPE');
});

test('row-level access fails closed when required shop scope is missing', () => {
  const requestContext = createRequestContext({
    correlationId: 'row-scope-missing-shop',
    scopes: [{ level: 'org', orgId: 'org-1' }]
  });

  const decision = evaluateRequestRowLevelAccess({
    requestContext,
    rowScope: { orgId: 'org-1', shopId: ' ' },
    minimumLevel: 'shop'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DENY_SCOPE_MISSING_SHOP');
});

test('row-level access fails closed when required team scope is missing', () => {
  const requestContext = createRequestContext({
    correlationId: 'row-scope-missing-team',
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  const decision = evaluateRequestRowLevelAccess({
    requestContext,
    rowScope: { orgId: 'org-1', shopId: 'shop-a', teamId: '' },
    minimumLevel: 'team'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DENY_SCOPE_MISSING_TEAM');
});

test('requireRowLevelAccess emits deterministic denial reason', async () => {
  const guard = requireRowLevelAccess(
    {
      orgId: 'org-1',
      shopId: 'shop-b'
    },
    { minimumLevel: 'shop' }
  );
  const requestContext = createRequestContext({
    correlationId: 'row-guard-denied',
    principal: buildPrincipal(),
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.code, 'AUTH_ROW_SCOPE_DENIED');
      assert.equal(error.reason, 'DENY_ROW_SCOPE');
      assert.equal(error.message, 'Row scope denied: shop:org-1:shop-b');
      return true;
    }
  );
});

test('authz repository supports scoped row filtering helper', async () => {
  const repository = new InMemoryAuthzRepository({
    roleScopeGrants: [
      {
        id: 'grant-shop-a',
        role: 'shop_manager',
        scope: { level: 'shop', orgId: 'org-1', shopId: 'shop-a' },
        status: 'ACTIVE'
      },
      {
        id: 'grant-shop-b',
        role: 'shop_manager',
        scope: { level: 'shop', orgId: 'org-1', shopId: 'shop-b' },
        status: 'ACTIVE'
      }
    ],
    userScopeAssignments: [
      {
        id: 'assignment-shop-a',
        userId: 'user-1',
        roleScopeGrantId: 'grant-shop-a',
        status: 'ACTIVE',
        effectiveFrom: '2025-01-01T00:00:00.000Z'
      },
      {
        id: 'assignment-shop-b',
        userId: 'user-1',
        roleScopeGrantId: 'grant-shop-b',
        status: 'ACTIVE',
        effectiveFrom: '2025-01-01T00:00:00.000Z'
      }
    ]
  });

  const scopedGrants = await repository.listScopedActiveRoleScopeGrantsForUser('user-1', {
    grantedScopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }],
    minimumLevel: 'shop'
  });
  assert.equal(scopedGrants.length, 1);
  const firstScope = scopedGrants[0]?.scope;
  assert.equal(firstScope?.level, 'shop');
  if (firstScope?.level === 'shop') {
    assert.equal(firstScope.shopId, 'shop-a');
  }

  const deniedByDefault = await repository.listScopedActiveRoleScopeGrantsForUser('user-1', {
    grantedScopes: [],
    minimumLevel: 'shop'
  });
  assert.equal(deniedByDefault.length, 0);
});
