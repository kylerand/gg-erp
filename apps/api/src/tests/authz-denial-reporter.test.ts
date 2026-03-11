import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAuditSink } from '../audit/recorder.js';
import {
  AUTHZ_DENIAL_REASON_CODES,
  createAuthzDeniedReporter,
  reportAuthzAllow
} from '../middleware/authz-denial-reporter.js';
import type { AuthorizationFailure } from '../middleware/authorize-permission.js';
import { createRequestContext } from '../middleware/request-context.js';
import { AUTH_METRICS, AUTH_TRACES } from '../observability/auth.js';
import type { ObservabilityContext, ObservabilityHooks } from '../observability/hooks.js';

interface ObservabilityProbe {
  hooks: ObservabilityHooks;
  traces: string[];
  errors: string[];
  metrics: string[];
}

function createObservabilityProbe(): ObservabilityProbe {
  const traces: string[] = [];
  const errors: string[] = [];
  const metrics: string[] = [];

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
    errors,
    metrics
  };
}

test('authz denial reporter records deterministic reason codes and scope metrics', async () => {
  const audit = new InMemoryAuditSink();
  const observability = createObservabilityProbe();
  const reporter = createAuthzDeniedReporter({
    audit,
    observability: observability.hooks,
    module: 'identity'
  });
  const requestContext = createRequestContext({
    correlationId: 'authz-denial-reporter',
    actorId: 'user-22'
  });
  const failure: AuthorizationFailure = {
    statusCode: 403,
    code: 'AUTH_SCOPE_DENIED',
    reason: 'DENY_SCOPE_MISSING_SHOP',
    message: 'Scope denied: shop scope is required',
    requestContext
  };

  reporter(failure);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(observability.metrics.includes(AUTH_METRICS.authzDeny));
  assert.ok(observability.metrics.includes(AUTH_METRICS.authzScopeDeny));
  assert.ok(observability.traces.includes(AUTH_TRACES.authzDeny));
  assert.ok(observability.traces.includes(AUTH_TRACES.authzScopeDeny));
  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'authz.scope_deny');
  assert.equal(
    (audit.list()[0]?.metadata as { reasonCode: string }).reasonCode,
    AUTHZ_DENIAL_REASON_CODES.DENY_SCOPE_MISSING_SHOP
  );
});

test('authz allow reporter emits authz.allow audit and metric', async () => {
  const audit = new InMemoryAuditSink();
  const observability = createObservabilityProbe();
  const requestContext = createRequestContext({
    correlationId: 'authz-allow-reporter',
    actorId: 'user-33'
  });

  reportAuthzAllow({
    audit,
    observability: observability.hooks,
    requestContext,
    module: 'identity',
    check: 'scope',
    detail: 'shop:org-1:shop-a'
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(observability.metrics.includes(AUTH_METRICS.authzAllow));
  assert.ok(observability.traces.includes(AUTH_TRACES.authzAllow));
  assert.equal(audit.list().length, 1);
  assert.equal(audit.list()[0]?.action, 'authz.allow');
});
