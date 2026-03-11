import type { AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import {
  evaluateRowLevelAccess
} from '../../../../packages/auth/src/row-access.js';
import {
  normalizeScopeGrants,
  scopeGrantKey,
  type ScopeGrant,
  type ScopeTarget
} from '../../../../packages/auth/src/scope.js';
import {
  requireAuthenticatedPrincipal,
  throwAuthorizationFailure,
  type AuthorizationGuard,
  type AuthorizationFailureReason,
  type AuthorizationGuardHooks
} from './authorize-permission.js';
import type { RequestContext } from './request-context.js';

export interface ResolveScopesInput {
  requestContext: RequestContext;
  principal: AuthPrincipal;
}

export interface RequireScopeOptions extends AuthorizationGuardHooks {
  resolveScopes?(input: ResolveScopesInput): readonly ScopeGrant[] | Promise<readonly ScopeGrant[]>;
  message?: string;
}

export function requireScope(
  requiredScope: ScopeTarget,
  options: RequireScopeOptions = {}
): AuthorizationGuard {
  return async (requestContext) => {
    const principal = requireAuthenticatedPrincipal(requestContext, options);
    const resolvedScopes = options.resolveScopes
      ? await options.resolveScopes({ requestContext, principal })
      : requestContext.scopes;
    const scopes = normalizeScopeGrants(resolvedScopes ?? []);
    const decision = evaluateRowLevelAccess({
      grantedScopes: scopes,
      rowScope: requiredScope,
      minimumLevel: requiredScope.level
    });

    if (decision.allowed) {
      return;
    }
    const deniedReason = decision.reason === 'ALLOW' ? 'DENY_SCOPE' : decision.reason;

    throwAuthorizationFailure(
      {
        statusCode: 403,
        code: 'AUTH_SCOPE_DENIED',
        reason: mapScopeDeniedReason(deniedReason),
        message: options.message ?? defaultDeniedMessage(deniedReason, decision.target, requiredScope),
        requestContext,
        principal
      },
      options
    );
  };
}

function mapScopeDeniedReason(
  reason: Exclude<ReturnType<typeof evaluateRowLevelAccess>['reason'], 'ALLOW'>
): AuthorizationFailureReason {
  switch (reason) {
    case 'DENY_SCOPE':
      return 'DENY_SCOPE';
    case 'DENY_SCOPE_MISSING_ORG':
      return 'DENY_SCOPE_MISSING_ORG';
    case 'DENY_SCOPE_MISSING_SHOP':
      return 'DENY_SCOPE_MISSING_SHOP';
    case 'DENY_SCOPE_MISSING_TEAM':
      return 'DENY_SCOPE_MISSING_TEAM';
  }
}

function defaultDeniedMessage(
  reason: Exclude<ReturnType<typeof evaluateRowLevelAccess>['reason'], 'ALLOW'>,
  normalizedTarget: ScopeTarget | undefined,
  fallbackTarget: ScopeTarget
): string {
  switch (reason) {
    case 'DENY_SCOPE':
      return `Scope denied: ${scopeGrantKey(normalizedTarget ?? fallbackTarget)}`;
    case 'DENY_SCOPE_MISSING_ORG':
      return 'Scope denied: org scope is required';
    case 'DENY_SCOPE_MISSING_SHOP':
      return 'Scope denied: shop scope is required';
    case 'DENY_SCOPE_MISSING_TEAM':
      return 'Scope denied: team scope is required';
  }
}
