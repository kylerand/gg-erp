import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import { createApiRuntime } from '../index.js';
import { AuthorizationGuardError } from '../middleware/authorize-permission.js';
import { createRequestContext } from '../middleware/request-context.js';

function buildPrincipal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'user-42',
    email: 'agent@example.com',
    roles: ['shop_manager'],
    groups: ['shop_manager'],
    orgId: 'org-1',
    shopId: 'shop-a',
    ...overrides
  };
}

test('missing principal => 401', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.authorizePermission('work_orders:read');
  const requestContext = createRequestContext({ correlationId: 'authz-401-missing-principal' });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'AUTH_PRINCIPAL_MISSING');
      assert.equal(error.reason, 'UNAUTHENTICATED');
      assert.equal(error.message, 'Authentication required: principal is missing');
      return true;
    }
  );
});

test('invalid principal => 401', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.authorizePermission('work_orders:read');
  const requestContext = createRequestContext({
    correlationId: 'authz-401-invalid-principal',
    principal: buildPrincipal({ userId: '   ' })
  });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'AUTH_PRINCIPAL_INVALID');
      assert.equal(error.reason, 'INVALID_PRINCIPAL');
      assert.equal(error.message, 'Authentication required: principal userId is invalid');
      return true;
    }
  );
});

test('missing permission => 403', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.authorizePermission('users:manage');
  const requestContext = createRequestContext({
    correlationId: 'authz-403-missing-permission',
    principal: buildPrincipal({ roles: ['technician'], groups: ['technician'] })
  });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'AUTH_PERMISSION_DENIED');
      assert.equal(error.reason, 'DENY_PERMISSION');
      assert.equal(error.message, 'Permission denied: users:manage');
      return true;
    }
  );
});

test('missing scope => 403', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.requireScope({
    level: 'shop',
    orgId: 'org-1',
    shopId: 'shop-b'
  });
  const requestContext = createRequestContext({
    correlationId: 'authz-403-missing-scope',
    principal: buildPrincipal(),
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'AUTH_SCOPE_DENIED');
      assert.equal(error.reason, 'DENY_SCOPE');
      assert.equal(error.message, 'Scope denied: shop:org-1:shop-b');
      return true;
    }
  );
});

test('invalid required scope shape fails with deterministic reason', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.requireScope({
    level: 'shop',
    orgId: 'org-1',
    shopId: ' '
  });
  const requestContext = createRequestContext({
    correlationId: 'authz-403-invalid-required-scope',
    principal: buildPrincipal(),
    scopes: [{ level: 'org', orgId: 'org-1' }]
  });

  await assert.rejects(
    async () => {
      await guard(requestContext);
    },
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationGuardError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'AUTH_SCOPE_DENIED');
      assert.equal(error.reason, 'DENY_SCOPE_MISSING_SHOP');
      assert.equal(error.message, 'Scope denied: shop scope is required');
      return true;
    }
  );
});

test('success path => allowed', async () => {
  const runtime = createApiRuntime();
  const guard = runtime.authz.guards.compose(
    runtime.authz.guards.authorizePermission('work_orders:read'),
    runtime.authz.guards.requireScope({
      level: 'shop',
      orgId: 'org-1',
      shopId: 'shop-a'
    })
  );
  const requestContext = createRequestContext({
    correlationId: 'authz-allowed',
    principal: buildPrincipal(),
    scopes: [{ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }]
  });

  await assert.doesNotReject(async () => {
    await guard(requestContext);
  });
});
