import { AUDIT_POINTS, type AuditSink } from '../audit/index.js';
import { AUTH_METRICS, AUTH_TRACES } from '../observability/auth.js';
import type { ObservabilityContext, ObservabilityHooks } from '../observability/hooks.js';
import type {
  AuthorizationFailure,
  AuthorizationFailureReason
} from './authorize-permission.js';
import type { RequestContext } from './request-context.js';

export const AUTHZ_DENIAL_REASON_CODES: Readonly<Record<AuthorizationFailureReason, string>> = {
  UNAUTHENTICATED: 'AUTHN_UNAUTHENTICATED',
  INVALID_PRINCIPAL: 'AUTHN_INVALID_PRINCIPAL',
  DENY_PERMISSION: 'AUTHZ_DENY_PERMISSION',
  DENY_SCOPE: 'AUTHZ_DENY_SCOPE',
  DENY_SCOPE_MISSING_ORG: 'AUTHZ_MISSING_ORG_SCOPE',
  DENY_SCOPE_MISSING_SHOP: 'AUTHZ_MISSING_SHOP_SCOPE',
  DENY_SCOPE_MISSING_TEAM: 'AUTHZ_MISSING_TEAM_SCOPE',
  DENY_ROW_SCOPE: 'AUTHZ_DENY_ROW_SCOPE'
};

export interface CreateAuthzDeniedReporterInput {
  audit: AuditSink;
  observability: ObservabilityHooks;
  module?: string;
}

export interface ReportAuthzAllowInput {
  audit: AuditSink;
  observability: ObservabilityHooks;
  requestContext: RequestContext;
  module?: string;
  check: 'permission' | 'scope' | 'row';
  detail?: string;
}

export function createAuthzDeniedReporter(
  input: CreateAuthzDeniedReporterInput
): (failure: AuthorizationFailure) => void {
  return (failure) => {
    const context = toObservabilityContext(failure.requestContext, input.module);
    const reasonCode = AUTHZ_DENIAL_REASON_CODES[failure.reason];
    const scopeDenied = isScopeDeniedReason(failure.reason);

    input.observability.logError(`${failure.message} [${reasonCode}]`, context);
    input.observability.trace(AUTH_TRACES.authzDeny, context);
    input.observability.metric(AUTH_METRICS.authzDeny, 1, context);

    if (scopeDenied) {
      input.observability.trace(AUTH_TRACES.authzScopeDeny, context);
      input.observability.metric(AUTH_METRICS.authzScopeDeny, 1, context);
    }

    void input.audit
      .record({
        actorId: failure.requestContext.actorId,
        action: auditPointForFailure(failure.reason),
        entityType: 'AuthorizationGuard',
        entityId: failure.principal?.userId ?? 'anonymous',
        correlationId: failure.requestContext.correlationId,
        metadata: {
          statusCode: failure.statusCode,
          code: failure.code,
          reason: failure.reason,
          reasonCode,
          permission: failure.permission
        },
        createdAt: new Date().toISOString()
      })
      .catch((error: unknown) => {
        input.observability.logError(
          `Authorization denial audit emission failed: ${toErrorMessage(error)}`,
          context
        );
      });
  };
}

export function reportAuthzAllow(input: ReportAuthzAllowInput): void {
  const context = toObservabilityContext(input.requestContext, input.module);

  input.observability.trace(AUTH_TRACES.authzAllow, context);
  input.observability.metric(AUTH_METRICS.authzAllow, 1, context);
  void input.audit
    .record({
      actorId: input.requestContext.actorId,
      action: AUDIT_POINTS.authzAllow,
      entityType: 'AuthorizationGuard',
      entityId: input.requestContext.actorId ?? 'anonymous',
      correlationId: input.requestContext.correlationId,
      metadata: {
        check: input.check,
        detail: input.detail
      },
      createdAt: new Date().toISOString()
    })
    .catch((error: unknown) => {
      input.observability.logError(
        `Authorization allow audit emission failed: ${toErrorMessage(error)}`,
        context
      );
    });
}

function toObservabilityContext(
  requestContext: Pick<RequestContext, 'correlationId' | 'actorId'>,
  module = 'identity'
): ObservabilityContext {
  return {
    correlationId: requestContext.correlationId,
    actorId: requestContext.actorId,
    module
  };
}

function auditPointForFailure(reason: AuthorizationFailureReason): string {
  switch (reason) {
    case 'UNAUTHENTICATED':
    case 'INVALID_PRINCIPAL':
      return AUDIT_POINTS.authnFailure;
    case 'DENY_SCOPE':
    case 'DENY_SCOPE_MISSING_ORG':
    case 'DENY_SCOPE_MISSING_SHOP':
    case 'DENY_SCOPE_MISSING_TEAM':
      return AUDIT_POINTS.authzScopeDeny;
    case 'DENY_ROW_SCOPE':
      return AUDIT_POINTS.authzRowScopeDeny;
    case 'DENY_PERMISSION':
      return AUDIT_POINTS.authzDeny;
  }
}

function isScopeDeniedReason(reason: AuthorizationFailureReason): boolean {
  return (
    reason === 'DENY_SCOPE' ||
    reason === 'DENY_SCOPE_MISSING_ORG' ||
    reason === 'DENY_SCOPE_MISSING_SHOP' ||
    reason === 'DENY_SCOPE_MISSING_TEAM' ||
    reason === 'DENY_ROW_SCOPE'
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
