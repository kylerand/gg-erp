import { randomUUID } from 'node:crypto';
import type { AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import { normalizeRoles, type Role } from '../../../../packages/auth/src/roles.js';
import { normalizeScopeGrants, type ScopeGrant } from '../../../../packages/auth/src/scope.js';

export interface RequestContext {
  correlationId: string;
  actorId?: string;
  principal?: AuthPrincipal;
  roles: Role[];
  scopes: ScopeGrant[];
}

export function createRequestContext(input?: Partial<RequestContext>): RequestContext {
  const principal = input?.principal;
  const roles = normalizeRoles(input?.roles ?? principal?.roles ?? []);
  const scopes = normalizeScopeGrants(input?.scopes ?? []);

  return {
    correlationId: input?.correlationId?.trim() || randomUUID(),
    actorId: input?.actorId?.trim() || principal?.userId,
    principal,
    roles,
    scopes
  };
}
