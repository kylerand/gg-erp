export const SCOPE_LEVELS = ['org', 'shop', 'team'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export interface OrgScopeGrant {
  level: 'org';
  orgId: string;
}

export interface ShopScopeGrant {
  level: 'shop';
  orgId: string;
  shopId: string;
}

export interface TeamScopeGrant {
  level: 'team';
  orgId: string;
  shopId: string;
  teamId: string;
}

export type ScopeGrant = OrgScopeGrant | ShopScopeGrant | TeamScopeGrant;
export type ScopeTarget = ScopeGrant;

export const ROLE_SCOPE_GRANT_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type RoleScopeGrantStatus = (typeof ROLE_SCOPE_GRANT_STATUSES)[number];

export interface RoleScopeGrant<TRole extends string = string> {
  id: string;
  role: TRole;
  scope: ScopeGrant;
  status: RoleScopeGrantStatus;
}

export const USER_SCOPE_ASSIGNMENT_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type UserScopeAssignmentStatus = (typeof USER_SCOPE_ASSIGNMENT_STATUSES)[number];

export interface UserScopeAssignment {
  id: string;
  userId: string;
  roleScopeGrantId: string;
  status: UserScopeAssignmentStatus;
  effectiveFrom: string;
  effectiveTo?: string;
}

const SCOPE_LEVEL_WEIGHT: Readonly<Record<ScopeLevel, number>> = {
  org: 1,
  shop: 2,
  team: 3
};

export function scopeGrantKey(grant: ScopeGrant): string {
  switch (grant.level) {
    case 'org':
      return `org:${grant.orgId.trim()}`;
    case 'shop':
      return `shop:${grant.orgId.trim()}:${grant.shopId.trim()}`;
    case 'team':
      return `team:${grant.orgId.trim()}:${grant.shopId.trim()}:${grant.teamId.trim()}`;
  }
}

export function normalizeScopeGrants(grants: readonly ScopeGrant[]): ScopeGrant[] {
  const deduped = new Map<string, ScopeGrant>();

  for (const grant of grants) {
    const normalized = normalizeScopeGrant(grant);
    if (!normalized) {
      continue;
    }
    deduped.set(scopeGrantKey(normalized), normalized);
  }

  return [...deduped.values()];
}

export function hasOrgScope(grants: readonly ScopeGrant[], orgId: string): boolean {
  return hasEffectiveScope(grants, { level: 'org', orgId });
}

export function hasShopScope(
  grants: readonly ScopeGrant[],
  orgId: string,
  shopId: string
): boolean {
  return hasEffectiveScope(grants, { level: 'shop', orgId, shopId });
}

export function hasTeamScope(
  grants: readonly ScopeGrant[],
  orgId: string,
  shopId: string,
  teamId: string
): boolean {
  return hasEffectiveScope(grants, { level: 'team', orgId, shopId, teamId });
}

export function resolveEffectiveScope(
  grants: readonly ScopeGrant[],
  target: ScopeTarget
): ScopeGrant | undefined {
  const normalizedTarget = normalizeScopeGrant(target);
  if (!normalizedTarget) {
    return undefined;
  }

  let effectiveScope: ScopeGrant | undefined;

  for (const grant of normalizeScopeGrants(grants)) {
    if (!matchesScopeTarget(grant, normalizedTarget)) {
      continue;
    }

    if (!effectiveScope || SCOPE_LEVEL_WEIGHT[grant.level] > SCOPE_LEVEL_WEIGHT[effectiveScope.level]) {
      effectiveScope = grant;
    }
  }

  return effectiveScope;
}

export function hasEffectiveScope(grants: readonly ScopeGrant[], target: ScopeTarget): boolean {
  return resolveEffectiveScope(grants, target) !== undefined;
}

function normalizeScopeGrant(grant: ScopeGrant): ScopeGrant | undefined {
  const orgId = grant.orgId.trim();
  if (!orgId) {
    return undefined;
  }

  if (grant.level === 'org') {
    return { level: 'org', orgId };
  }

  const shopId = grant.shopId.trim();
  if (!shopId) {
    return undefined;
  }

  if (grant.level === 'shop') {
    return { level: 'shop', orgId, shopId };
  }

  const teamId = grant.teamId.trim();
  if (!teamId) {
    return undefined;
  }

  return {
    level: 'team',
    orgId,
    shopId,
    teamId
  };
}

function matchesScopeTarget(grant: ScopeGrant, target: ScopeTarget): boolean {
  if (grant.orgId !== target.orgId) {
    return false;
  }

  if (target.level === 'org') {
    return grant.level === 'org';
  }

  if (target.level === 'shop') {
    return (
      grant.level === 'org' ||
      (grant.level === 'shop' && grant.shopId === target.shopId)
    );
  }

  if (grant.level === 'org') {
    return true;
  }

  if (grant.level === 'shop') {
    return grant.shopId === target.shopId;
  }

  return grant.shopId === target.shopId && grant.teamId === target.teamId;
}
