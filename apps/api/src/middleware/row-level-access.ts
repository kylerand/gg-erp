import {
  evaluateRowLevelAccess,
  filterRowsByScope,
  type RowLevelAccessDecision,
  type RowLevelFilterResult,
  type RowScopeInput
} from '../../../../packages/auth/src/row-access.js';
import {
  scopeGrantKey,
  type ScopeGrant,
  type ScopeLevel
} from '../../../../packages/auth/src/scope.js';
import {
  requireAuthenticatedPrincipal,
  throwAuthorizationFailure,
  type AuthorizationFailureReason,
  type AuthorizationGuard,
  type AuthorizationGuardHooks
} from './authorize-permission.js';
import type { RequestContext } from './request-context.js';

export type RowLevelAccessDenyReason = Exclude<RowLevelAccessDecision['reason'], 'ALLOW'>;

const DEFAULT_MINIMUM_SCOPE_LEVEL: ScopeLevel = 'shop';

export interface EvaluateRequestRowLevelAccessInput {
  requestContext: RequestContext;
  rowScope: RowScopeInput;
  minimumLevel?: ScopeLevel;
  grantedScopes?: readonly ScopeGrant[];
}

export interface FilterRowsForRequestScopeInput<TRow> {
  rows: readonly TRow[];
  requestContext: RequestContext;
  getRowScope(row: TRow): RowScopeInput;
  minimumLevel?: ScopeLevel;
  grantedScopes?: readonly ScopeGrant[];
}

export interface RequireRowLevelAccessOptions extends AuthorizationGuardHooks {
  minimumLevel?: ScopeLevel;
  grantedScopes?: readonly ScopeGrant[];
  message?: string;
}

export function evaluateRequestRowLevelAccess(
  input: EvaluateRequestRowLevelAccessInput
): RowLevelAccessDecision {
  return evaluateRowLevelAccess({
    grantedScopes: resolveGrantedScopes(input.requestContext, input.grantedScopes),
    rowScope: input.rowScope,
    minimumLevel: input.minimumLevel ?? DEFAULT_MINIMUM_SCOPE_LEVEL
  });
}

export function filterRowsForRequestScope<TRow>(
  input: FilterRowsForRequestScopeInput<TRow>
): RowLevelFilterResult<TRow> {
  return filterRowsByScope({
    rows: input.rows,
    grantedScopes: resolveGrantedScopes(input.requestContext, input.grantedScopes),
    getRowScope: input.getRowScope,
    minimumLevel: input.minimumLevel ?? DEFAULT_MINIMUM_SCOPE_LEVEL
  });
}

export function requireRowLevelAccess(
  rowScope: RowScopeInput,
  options: RequireRowLevelAccessOptions = {}
): AuthorizationGuard {
  return (requestContext) => {
    const principal = requireAuthenticatedPrincipal(requestContext, options);
    const decision = evaluateRequestRowLevelAccess({
      requestContext,
      rowScope,
      minimumLevel: options.minimumLevel,
      grantedScopes: options.grantedScopes
    });

    if (decision.allowed) {
      return;
    }
    const deniedReason = decision.reason === 'ALLOW' ? 'DENY_SCOPE' : decision.reason;

    throwAuthorizationFailure(
      {
        statusCode: 403,
        code: 'AUTH_ROW_SCOPE_DENIED',
        reason: toAuthorizationFailureReason(deniedReason),
        message: options.message ?? rowLevelDeniedMessage(decision),
        requestContext,
        principal
      },
      options
    );
  };
}

function resolveGrantedScopes(
  requestContext: RequestContext,
  overrideScopes?: readonly ScopeGrant[]
): readonly ScopeGrant[] {
  return overrideScopes ?? requestContext.scopes;
}

function toAuthorizationFailureReason(reason: RowLevelAccessDenyReason): AuthorizationFailureReason {
  switch (reason) {
    case 'DENY_SCOPE_MISSING_ORG':
      return 'DENY_SCOPE_MISSING_ORG';
    case 'DENY_SCOPE_MISSING_SHOP':
      return 'DENY_SCOPE_MISSING_SHOP';
    case 'DENY_SCOPE_MISSING_TEAM':
      return 'DENY_SCOPE_MISSING_TEAM';
    case 'DENY_SCOPE':
      return 'DENY_ROW_SCOPE';
  }
}

function rowLevelDeniedMessage(decision: RowLevelAccessDecision): string {
  switch (decision.reason) {
    case 'DENY_SCOPE_MISSING_ORG':
      return 'Row scope denied: org scope is required';
    case 'DENY_SCOPE_MISSING_SHOP':
      return 'Row scope denied: shop scope is required';
    case 'DENY_SCOPE_MISSING_TEAM':
      return 'Row scope denied: team scope is required';
    case 'DENY_SCOPE':
      return decision.target
        ? `Row scope denied: ${scopeGrantKey(decision.target)}`
        : 'Row scope denied';
    case 'ALLOW':
      return 'Row scope allowed';
  }
}
