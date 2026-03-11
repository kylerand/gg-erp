import { normalizeRoles, type Role } from './roles.js';
import type { CognitoJwtClaims } from './jwt.js';

export interface AuthPrincipal {
  userId: string;
  email?: string;
  roles: Role[];
  groups: string[];
  orgId?: string;
  shopId?: string;
}

function normalizeGroups(groups: readonly string[]): string[] {
  const deduplicatedGroups = new Set<string>();

  for (const group of groups) {
    const normalized = group.trim();
    if (normalized.length > 0) {
      deduplicatedGroups.add(normalized);
    }
  }

  return [...deduplicatedGroups];
}

export function createAuthPrincipal(
  claims: Pick<CognitoJwtClaims, 'sub' | 'email' | 'groups' | 'orgId' | 'shopId'>
): AuthPrincipal {
  const userId = claims.sub.trim();
  if (!userId) {
    throw new Error('JWT subject is required');
  }

  const groups = normalizeGroups(claims.groups);

  return {
    userId,
    email: claims.email,
    groups,
    roles: normalizeRoles(groups),
    orgId: claims.orgId,
    shopId: claims.shopId
  };
}
