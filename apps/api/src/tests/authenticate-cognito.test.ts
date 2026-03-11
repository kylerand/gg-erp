import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticateCognito,
  cognitoValidationOptionsFromEnv
} from '../middleware/authenticate-cognito.js';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { AUTH_METRICS, AUTH_TRACES } from '../observability/auth.js';
import type { ObservabilityContext, ObservabilityHooks } from '../observability/hooks.js';

const now = 1_730_000_000;
const validation = {
  issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_example',
  audience: 'erp-web-client',
  tokenUse: 'access' as const,
  now
};

interface ObservabilityProbe {
  hooks: ObservabilityHooks;
  traces: string[];
  metrics: string[];
  errors: string[];
}

function createObservabilityProbe(): ObservabilityProbe {
  const traces: string[] = [];
  const metrics: string[] = [];
  const errors: string[] = [];

  return {
    hooks: {
      logInfo(_message: string, _context: ObservabilityContext): void {},
      logError(message: string, _context: ObservabilityContext): void {
        errors.push(message);
      },
      metric(name: string, _value: number, _context: ObservabilityContext): void {
        metrics.push(name);
      },
      trace(operation: string, _context: ObservabilityContext): void {
        traces.push(operation);
      }
    },
    traces,
    metrics,
    errors
  };
}

function buildClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-123',
    email: 'agent@example.com',
    iss: validation.issuer,
    token_use: 'access',
    aud: validation.audience,
    client_id: validation.audience,
    exp: now + 3600,
    iat: now - 120,
    'cognito:groups': ['admin', 'shop_manager', 'unknown-group', 'admin'],
    'custom:org_id': 'org-44',
    'custom:shop_id': 'shop-12',
    ...overrides
  };
}

test('authenticateCognito maps Cognito claims into principal + request context', () => {
  const context = authenticateCognito({
    claims: buildClaims(),
    validation,
    requestContext: { correlationId: 'corr-101' }
  });

  assert.equal(context.correlationId, 'corr-101');
  assert.equal(context.actorId, 'user-123');
  assert.equal(context.principal.userId, 'user-123');
  assert.equal(context.principal.email, 'agent@example.com');
  assert.deepEqual(context.principal.groups, ['admin', 'shop_manager', 'unknown-group']);
  assert.deepEqual(context.principal.roles, ['admin', 'shop_manager']);
  assert.equal(context.principal.orgId, 'org-44');
  assert.equal(context.principal.shopId, 'shop-12');
});

test('authenticateCognito rejects claims with wrong issuer', () => {
  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ iss: 'https://cognito-idp.us-east-2.amazonaws.com/other-pool' }),
        validation
      }),
    /Invalid JWT issuer/
  );
});

test('authenticateCognito rejects claims with wrong audience', () => {
  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ aud: 'other-client-id', client_id: 'other-client-id' }),
        validation
      }),
    /Invalid JWT audience/
  );
});

test('authenticateCognito rejects claims with wrong token_use', () => {
  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ token_use: 'id' }),
        validation
      }),
    /Invalid JWT token_use/
  );
});

test('authenticateCognito rejects expired claims', () => {
  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ exp: now - 1 }),
        validation
      }),
    /JWT expired/
  );
});

test('authenticateCognito rejects claims with iat in the future', () => {
  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ iat: now + 120 }),
        validation
      }),
    /JWT iat is in the future/
  );
});

test('authenticateCognito emits authn success observability and audit hooks', () => {
  const observability = createObservabilityProbe();
  const audit = new InMemoryAuditSink();

  authenticateCognito({
    claims: buildClaims(),
    validation,
    requestContext: { correlationId: 'authn-success-hook' },
    observability: observability.hooks,
    audit
  });

  assert.ok(observability.traces.includes(AUTH_TRACES.authnValidateJwt));
  assert.ok(observability.metrics.includes(AUTH_METRICS.authnSuccess));
  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'authn.success');
});

test('authenticateCognito emits authn failure observability and audit hooks', () => {
  const observability = createObservabilityProbe();
  const audit = new InMemoryAuditSink();

  assert.throws(
    () =>
      authenticateCognito({
        claims: buildClaims({ token_use: 'id' }),
        validation,
        requestContext: { correlationId: 'authn-failure-hook' },
        observability: observability.hooks,
        audit
      }),
    /Invalid JWT token_use/
  );

  assert.ok(observability.traces.includes(AUTH_TRACES.authnValidateJwt));
  assert.ok(observability.metrics.includes(AUTH_METRICS.authnFailure));
  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'authn.failure');
  assert.equal(observability.errors.length, 1);
});

test('cognitoValidationOptionsFromEnv maps validation settings', () => {
  assert.deepEqual(
    cognitoValidationOptionsFromEnv({
      issuer: validation.issuer,
      audience: validation.audience,
      userPoolId: 'us-east-2_example',
      region: 'us-east-2',
      tokenUse: 'access',
      clockSkewSeconds: 30
    }),
    {
      issuer: validation.issuer,
      audience: validation.audience,
      tokenUse: 'access',
      clockSkewSeconds: 30
    }
  );
});
