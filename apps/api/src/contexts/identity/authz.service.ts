import type { Permission } from '../../../../../packages/auth/src/permissions.js';
import { hasPermission, permissionsForRoles } from '../../../../../packages/auth/src/rbac.js';
import {
  resolveRequiredScopeTarget,
  type ScopeTargetResolutionReason
} from '../../../../../packages/auth/src/row-access.js';
import {
  hasEffectiveScope,
  hasShopScope as hasShopScopeGrant,
  hasTeamScope as hasTeamScopeGrant,
  normalizeScopeGrants,
  type ScopeLevel,
  type ScopeGrant,
  type ScopeTarget
} from '../../../../../packages/auth/src/scope.js';
import type { Role } from '../../../../../packages/auth/src/roles.js';
import type { ActiveRoleScopeGrant, AuthzRepository } from './authz.repository.js';

export interface AuthzServiceDeps {
  repository: AuthzRepository;
}

export interface ShopScopeLookupInput {
  userId: string;
  orgId: string;
  shopId: string;
  asOf?: string;
}

export interface TeamScopeLookupInput extends ShopScopeLookupInput {
  teamId: string;
}

export interface AuthorizationScopeInput {
  orgId: string;
  shopId?: string;
  teamId?: string;
}

export interface AuthorizationRequest {
  userId: string;
  permission: Permission;
  scope: AuthorizationScopeInput;
  asOf?: string;
}

export type AuthorizationDecisionReason =
  | 'ALLOWED'
  | 'DENY_NO_ACTIVE_GRANTS'
  | 'DENY_PERMISSION'
  | 'DENY_SCOPE'
  | 'DENY_SCOPE_MISSING_ORG'
  | 'DENY_SCOPE_MISSING_SHOP'
  | 'DENY_SCOPE_MISSING_TEAM';

export interface AuthorizationDecision {
  allowed: boolean;
  reason: AuthorizationDecisionReason;
  roles: Role[];
  grantedPermissions: Permission[];
  matchingScopes: ScopeGrant[];
}

export class AuthzService {
  constructor(private readonly deps: AuthzServiceDeps) {}

  async listActiveRoleScopeGrantsForUser(
    userId: string,
    asOf?: string
  ): Promise<ActiveRoleScopeGrant[]> {
    return this.deps.repository.listActiveRoleScopeGrantsForUser(userId, asOf);
  }

  async listScopedActiveRoleScopeGrantsForUser(
    userId: string,
    grantedScopes: readonly ScopeGrant[],
    minimumLevel: ScopeLevel = 'shop',
    asOf?: string
  ): Promise<ActiveRoleScopeGrant[]> {
    return this.deps.repository.listScopedActiveRoleScopeGrantsForUser(userId, {
      grantedScopes,
      minimumLevel,
      asOf
    });
  }

  async hasShopScope(input: ShopScopeLookupInput): Promise<boolean> {
    const scopes = await this.listScopedGrants(input.userId, input.asOf);
    return hasShopScopeGrant(scopes, input.orgId, input.shopId);
  }

  async hasTeamScope(input: TeamScopeLookupInput): Promise<boolean> {
    const scopes = await this.listScopedGrants(input.userId, input.asOf);
    return hasTeamScopeGrant(scopes, input.orgId, input.shopId, input.teamId);
  }

  async authorize(input: AuthorizationRequest): Promise<AuthorizationDecision> {
    const activeGrants = await this.deps.repository.listActiveRoleScopeGrantsForUser(
      input.userId,
      input.asOf
    );

    if (activeGrants.length === 0) {
      return deny('DENY_NO_ACTIVE_GRANTS', [], []);
    }

    const roles = dedupeRoles(activeGrants.map((grant) => grant.role));
    const grantedPermissions = permissionsForRoles(roles);

    if (!hasPermission(roles, input.permission)) {
      return deny('DENY_PERMISSION', roles, grantedPermissions);
    }

    const target = toScopeTarget(input.scope);
    if (!target.ok) {
      return deny(scopeTargetToDecisionReason(target.reason), roles, grantedPermissions);
    }

    const matchingScopes = normalizeScopeGrants(
      activeGrants
        .map((grant) => grant.scope)
        .filter((scope) => hasEffectiveScope([scope], target.target))
    );

    if (matchingScopes.length === 0) {
      return deny('DENY_SCOPE', roles, grantedPermissions);
    }

    return {
      allowed: true,
      reason: 'ALLOWED',
      roles,
      grantedPermissions,
      matchingScopes
    };
  }

  private async listScopedGrants(userId: string, asOf?: string): Promise<ScopeGrant[]> {
    const grants = await this.deps.repository.listActiveRoleScopeGrantsForUser(userId, asOf);
    return normalizeScopeGrants(grants.map((grant) => grant.scope));
  }
}

function toScopeTarget(scope: AuthorizationScopeInput):
  | { ok: true; target: ScopeTarget }
  | { ok: false; reason: ScopeTargetResolutionReason } {
  const minimumLevel: ScopeLevel = scope.teamId !== undefined ? 'team' : scope.shopId !== undefined ? 'shop' : 'org';
  return resolveRequiredScopeTarget(scope, minimumLevel);
}

function scopeTargetToDecisionReason(
  reason: ScopeTargetResolutionReason
): Exclude<AuthorizationDecisionReason, 'ALLOWED'> {
  switch (reason) {
    case 'DENY_SCOPE_MISSING_ORG':
      return 'DENY_SCOPE_MISSING_ORG';
    case 'DENY_SCOPE_MISSING_SHOP':
      return 'DENY_SCOPE_MISSING_SHOP';
    case 'DENY_SCOPE_MISSING_TEAM':
      return 'DENY_SCOPE_MISSING_TEAM';
  }
}

function dedupeRoles(roles: readonly Role[]): Role[] {
  return [...new Set(roles)];
}

function deny(
  reason: Exclude<AuthorizationDecisionReason, 'ALLOWED'>,
  roles: Role[],
  grantedPermissions: Permission[]
): AuthorizationDecision {
  return {
    allowed: false,
    reason,
    roles,
    grantedPermissions,
    matchingScopes: []
  };
}
