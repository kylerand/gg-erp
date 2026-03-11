import {
  hasEffectiveScope,
  normalizeScopeGrants,
  type ScopeGrant,
  type ScopeLevel,
  type ScopeTarget
} from './scope.js';

export interface RowScopeInput {
  orgId?: string;
  shopId?: string;
  teamId?: string;
}

export type ScopeTargetResolutionReason =
  | 'DENY_SCOPE_MISSING_ORG'
  | 'DENY_SCOPE_MISSING_SHOP'
  | 'DENY_SCOPE_MISSING_TEAM';

export type ScopeTargetResolution =
  | { ok: true; target: ScopeTarget }
  | { ok: false; reason: ScopeTargetResolutionReason };

export type RowLevelAccessReason = 'ALLOW' | ScopeTargetResolutionReason | 'DENY_SCOPE';

export interface RowLevelAccessDecision {
  allowed: boolean;
  reason: RowLevelAccessReason;
  target?: ScopeTarget;
}

export interface EvaluateRowLevelAccessInput {
  grantedScopes: readonly ScopeGrant[];
  rowScope: RowScopeInput;
  minimumLevel?: ScopeLevel;
}

export interface RowLevelFilterInput<TRow> {
  rows: readonly TRow[];
  grantedScopes: readonly ScopeGrant[];
  getRowScope(row: TRow): RowScopeInput;
  minimumLevel?: ScopeLevel;
}

export interface RowLevelFilterResult<TRow> {
  allowedRows: TRow[];
  deniedRows: {
    row: TRow;
    reason: Exclude<RowLevelAccessReason, 'ALLOW'>;
  }[];
}

export function resolveRequiredScopeTarget(
  scope: RowScopeInput,
  minimumLevel: ScopeLevel = 'org'
): ScopeTargetResolution {
  const orgId = normalizeScopeField(scope.orgId);
  if (!orgId) {
    return {
      ok: false,
      reason: 'DENY_SCOPE_MISSING_ORG'
    };
  }

  const shopId = normalizeScopeField(scope.shopId);
  const teamId = normalizeScopeField(scope.teamId);

  if (minimumLevel === 'team' || teamId) {
    if (!shopId) {
      return {
        ok: false,
        reason: 'DENY_SCOPE_MISSING_SHOP'
      };
    }

    if (!teamId) {
      return {
        ok: false,
        reason: 'DENY_SCOPE_MISSING_TEAM'
      };
    }

    return {
      ok: true,
      target: {
        level: 'team',
        orgId,
        shopId,
        teamId
      }
    };
  }

  if (minimumLevel === 'shop' || shopId) {
    if (!shopId) {
      return {
        ok: false,
        reason: 'DENY_SCOPE_MISSING_SHOP'
      };
    }

    return {
      ok: true,
      target: {
        level: 'shop',
        orgId,
        shopId
      }
    };
  }

  return {
    ok: true,
    target: {
      level: 'org',
      orgId
    }
  };
}

export function evaluateRowLevelAccess(input: EvaluateRowLevelAccessInput): RowLevelAccessDecision {
  const target = resolveRequiredScopeTarget(input.rowScope, input.minimumLevel);
  if (!target.ok) {
    return {
      allowed: false,
      reason: target.reason
    };
  }

  const grantedScopes = normalizeScopeGrants(input.grantedScopes);
  if (hasEffectiveScope(grantedScopes, target.target)) {
    return {
      allowed: true,
      reason: 'ALLOW',
      target: target.target
    };
  }

  return {
    allowed: false,
    reason: 'DENY_SCOPE',
    target: target.target
  };
}

export function filterRowsByScope<TRow>(input: RowLevelFilterInput<TRow>): RowLevelFilterResult<TRow> {
  const allowedRows: TRow[] = [];
  const deniedRows: RowLevelFilterResult<TRow>['deniedRows'] = [];

  for (const row of input.rows) {
    const decision = evaluateRowLevelAccess({
      grantedScopes: input.grantedScopes,
      rowScope: input.getRowScope(row),
      minimumLevel: input.minimumLevel
    });

    if (decision.allowed) {
      allowedRows.push(row);
      continue;
    }
    const deniedReason = decision.reason === 'ALLOW' ? 'DENY_SCOPE' : decision.reason;

    deniedRows.push({
      row,
      reason: deniedReason
    });
  }

  return {
    allowedRows,
    deniedRows
  };
}

function normalizeScopeField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
