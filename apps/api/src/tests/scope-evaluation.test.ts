import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasEffectiveScope,
  hasShopScope,
  hasTeamScope,
  resolveEffectiveScope,
  type ScopeGrant
} from '../../../../packages/auth/src/scope.js';
import { InMemoryAuthzRepository } from '../contexts/identity/authz.repository.js';
import { AuthzService } from '../contexts/identity/authz.service.js';

test('scope helpers deny cross-shop access by default', () => {
  const grants: ScopeGrant[] = [
    {
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    }
  ];

  assert.equal(hasShopScope(grants, 'org-1', 'shop-a'), true);
  assert.equal(hasShopScope(grants, 'org-1', 'shop-b'), false);
  assert.equal(hasTeamScope(grants, 'org-1', 'shop-b', 'team-1'), false);
});

test('scope helpers enforce hierarchy from org -> shop -> team', () => {
  const grants: ScopeGrant[] = [
    {
      level: 'org',
      orgId: 'org-1'
    },
    {
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    }
  ];

  assert.equal(hasShopScope(grants, 'org-1', 'shop-a'), true);
  assert.equal(hasTeamScope(grants, 'org-1', 'shop-a', 'team-1'), true);
  assert.equal(hasShopScope(grants, 'org-2', 'shop-z'), false);
});

test('effective scope resolution returns the most specific matching grant', () => {
  const grants: ScopeGrant[] = [
    {
      level: 'org',
      orgId: 'org-1'
    },
    {
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    },
    {
      level: 'team',
      orgId: 'org-1',
      shopId: 'shop-a',
      teamId: 'team-7'
    }
  ];

  assert.equal(
    resolveEffectiveScope(grants, {
      level: 'team',
      orgId: 'org-1',
      shopId: 'shop-a',
      teamId: 'team-7'
    })?.level,
    'team'
  );
  assert.equal(
    resolveEffectiveScope(grants, {
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    })?.level,
    'shop'
  );
  assert.equal(
    hasEffectiveScope([], {
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    }),
    false
  );
});

test('authz service checks permission and scoped grants with deny-by-default behavior', async () => {
  const repository = new InMemoryAuthzRepository({
    roleScopeGrants: [
      {
        id: 'grant-shop-a-manager',
        role: 'shop_manager',
        scope: {
          level: 'shop',
          orgId: 'org-1',
          shopId: 'shop-a'
        },
        status: 'ACTIVE'
      }
    ],
    userScopeAssignments: [
      {
        id: 'assignment-1',
        userId: 'user-1',
        roleScopeGrantId: 'grant-shop-a-manager',
        status: 'ACTIVE',
        effectiveFrom: '2025-01-01T00:00:00.000Z'
      }
    ]
  });
  const service = new AuthzService({ repository });

  const allowed = await service.authorize({
    userId: 'user-1',
    permission: 'work_orders:read',
    scope: { orgId: 'org-1', shopId: 'shop-a' }
  });
  assert.equal(allowed.allowed, true);

  const wrongShop = await service.authorize({
    userId: 'user-1',
    permission: 'work_orders:read',
    scope: { orgId: 'org-1', shopId: 'shop-b' }
  });
  assert.equal(wrongShop.allowed, false);
  assert.equal(wrongShop.reason, 'DENY_SCOPE');

  const wrongPermission = await service.authorize({
    userId: 'user-1',
    permission: 'users:manage',
    scope: { orgId: 'org-1', shopId: 'shop-a' }
  });
  assert.equal(wrongPermission.allowed, false);
  assert.equal(wrongPermission.reason, 'DENY_PERMISSION');

  const missingShopScope = await service.authorize({
    userId: 'user-1',
    permission: 'work_orders:read',
    scope: { orgId: 'org-1', shopId: '   ' }
  });
  assert.equal(missingShopScope.allowed, false);
  assert.equal(missingShopScope.reason, 'DENY_SCOPE_MISSING_SHOP');
});
