import {
  normalizeCognitoJwtClaims,
  type CognitoJwtClaims,
  type CognitoJwtValidationOptions
} from '../../../../packages/auth/src/jwt.js';
import { createAuthPrincipal, type AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import type { AuditSink } from '../audit/index.js';
import { AUDIT_POINTS } from '../audit/index.js';
import type { CognitoEnv } from '../config/env.js';
import { AUTH_METRICS, AUTH_TRACES } from '../observability/auth.js';
import type { ObservabilityHooks } from '../observability/hooks.js';
import { createRequestContext, type RequestContext } from './request-context.js';

export interface AuthenticateCognitoInput {
  claims: Record<string, unknown>;
  validation: CognitoJwtValidationOptions;
  requestContext?: Partial<RequestContext>;
  observability?: ObservabilityHooks;
  audit?: AuditSink;
  module?: string;
}

export interface AuthenticatedRequestContext extends RequestContext {
  actorId: string;
  principal: AuthPrincipal;
  authClaims: CognitoJwtClaims;
}

export function cognitoValidationOptionsFromEnv(
  config: CognitoEnv
): CognitoJwtValidationOptions {
  return {
    issuer: config.issuer,
    audience: config.audience,
    tokenUse: config.tokenUse,
    clockSkewSeconds: config.clockSkewSeconds
  };
}

export function authenticateCognito(input: AuthenticateCognitoInput): AuthenticatedRequestContext {
  const initialContext = createRequestContext(input.requestContext);
  const authModule = input.module ?? 'identity';
  const telemetryContext = {
    correlationId: initialContext.correlationId,
    actorId: initialContext.actorId,
    module: authModule
  };
  input.observability?.trace(AUTH_TRACES.authnValidateJwt, telemetryContext);

  try {
    const authClaims = normalizeCognitoJwtClaims(input.claims, input.validation);
    const principal = createAuthPrincipal(authClaims);
    const requestContext = createRequestContext({
      ...initialContext,
      actorId: initialContext.actorId ?? principal.userId,
      principal
    });
    const authenticatedContext: AuthenticatedRequestContext = {
      ...requestContext,
      actorId: requestContext.actorId ?? principal.userId,
      principal,
      authClaims
    };

    input.observability?.metric(AUTH_METRICS.authnSuccess, 1, {
      ...telemetryContext,
      actorId: authenticatedContext.actorId
    });
    recordAuthnAudit({
      sink: input.audit,
      action: AUDIT_POINTS.authnSuccess,
      correlationId: telemetryContext.correlationId,
      actorId: authenticatedContext.actorId,
      entityId: principal.userId,
      metadata: {
        issuer: authClaims.iss,
        tokenUse: authClaims.tokenUse,
        audience: authClaims.audience
      },
      observability: input.observability,
      module: authModule
    });

    return authenticatedContext;
  } catch (error) {
    const subject = typeof input.claims.sub === 'string' ? input.claims.sub.trim() : undefined;
    const entityId = subject && subject.length > 0 ? subject : 'unknown';
    input.observability?.metric(AUTH_METRICS.authnFailure, 1, telemetryContext);
    input.observability?.logError(`Cognito authentication failed: ${toErrorMessage(error)}`, telemetryContext);
    recordAuthnAudit({
      sink: input.audit,
      action: AUDIT_POINTS.authnFailure,
      correlationId: telemetryContext.correlationId,
      actorId: telemetryContext.actorId,
      entityId,
      metadata: {
        error: toErrorMessage(error),
        tokenUse: input.validation.tokenUse
      },
      observability: input.observability,
      module: authModule
    });
    throw error;
  }
}

interface RecordAuthnAuditInput {
  sink: AuditSink | undefined;
  action: string;
  correlationId: string;
  actorId?: string;
  entityId: string;
  metadata: unknown;
  observability?: ObservabilityHooks;
  module: string;
}

function recordAuthnAudit(input: RecordAuthnAuditInput): void {
  if (!input.sink) {
    return;
  }

  void input.sink
    .record({
      actorId: input.actorId,
      action: input.action,
      entityType: 'Authentication',
      entityId: input.entityId,
      correlationId: input.correlationId,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    })
    .catch((error: unknown) => {
      input.observability?.logError(
        `Authentication audit emission failed: ${toErrorMessage(error)}`,
        {
          correlationId: input.correlationId,
          actorId: input.actorId,
          module: input.module
        }
      );
    });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
