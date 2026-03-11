import type { Role } from '../../../../../packages/auth/src/roles.js';
import type {
  RoleScopeGrant,
  ScopeGrant,
  ScopeLevel,
  UserScopeAssignment
} from '../../../../../packages/auth/src/scope.js';
import { filterRowsByScope } from '../../../../../packages/auth/src/row-access.js';

export type PersistedRoleScopeGrant = RoleScopeGrant<Role>;
export type PersistedUserScopeAssignment = UserScopeAssignment;

export interface ActiveRoleScopeGrant extends PersistedRoleScopeGrant {
  assignmentId: string;
  userId: string;
}

export interface ScopedRoleScopeGrantQuery {
  grantedScopes: readonly ScopeGrant[];
  minimumLevel?: ScopeLevel;
  asOf?: string;
}

export interface AuthzRepository {
  saveRoleScopeGrant(grant: PersistedRoleScopeGrant): Promise<void>;
  findRoleScopeGrantById(id: string): Promise<PersistedRoleScopeGrant | undefined>;
  listRoleScopeGrants(): Promise<PersistedRoleScopeGrant[]>;

  saveUserScopeAssignment(assignment: PersistedUserScopeAssignment): Promise<void>;
  listUserScopeAssignments(userId: string): Promise<PersistedUserScopeAssignment[]>;
  listActiveRoleScopeGrantsForUser(userId: string, asOf?: string): Promise<ActiveRoleScopeGrant[]>;
  listScopedActiveRoleScopeGrantsForUser(
    userId: string,
    query: ScopedRoleScopeGrantQuery
  ): Promise<ActiveRoleScopeGrant[]>;
}

export interface InMemoryAuthzRepositorySeed {
  roleScopeGrants?: readonly PersistedRoleScopeGrant[];
  userScopeAssignments?: readonly PersistedUserScopeAssignment[];
}

export class InMemoryAuthzRepository implements AuthzRepository {
  private readonly roleScopeGrants = new Map<string, PersistedRoleScopeGrant>();
  private readonly userScopeAssignments = new Map<string, PersistedUserScopeAssignment>();

  constructor(seed: InMemoryAuthzRepositorySeed = {}) {
    for (const grant of seed.roleScopeGrants ?? []) {
      this.roleScopeGrants.set(grant.id, grant);
    }

    for (const assignment of seed.userScopeAssignments ?? []) {
      this.userScopeAssignments.set(assignment.id, assignment);
    }
  }

  async saveRoleScopeGrant(grant: PersistedRoleScopeGrant): Promise<void> {
    this.roleScopeGrants.set(grant.id, grant);
  }

  async findRoleScopeGrantById(id: string): Promise<PersistedRoleScopeGrant | undefined> {
    return this.roleScopeGrants.get(id);
  }

  async listRoleScopeGrants(): Promise<PersistedRoleScopeGrant[]> {
    return [...this.roleScopeGrants.values()];
  }

  async saveUserScopeAssignment(assignment: PersistedUserScopeAssignment): Promise<void> {
    this.userScopeAssignments.set(assignment.id, assignment);
  }

  async listUserScopeAssignments(userId: string): Promise<PersistedUserScopeAssignment[]> {
    return [...this.userScopeAssignments.values()].filter((assignment) => assignment.userId === userId);
  }

  async listActiveRoleScopeGrantsForUser(
    userId: string,
    asOf = new Date().toISOString()
  ): Promise<ActiveRoleScopeGrant[]> {
    const asOfDate = new Date(asOf);
    if (Number.isNaN(asOfDate.valueOf())) {
      return [];
    }

    const activeGrants: ActiveRoleScopeGrant[] = [];
    for (const assignment of this.userScopeAssignments.values()) {
      if (assignment.userId !== userId || assignment.status !== 'ACTIVE') {
        continue;
      }

      if (!isWithinEffectiveWindow(assignment, asOfDate)) {
        continue;
      }

      const grant = this.roleScopeGrants.get(assignment.roleScopeGrantId);
      if (!grant || grant.status !== 'ACTIVE') {
        continue;
      }

      activeGrants.push({
        ...grant,
        assignmentId: assignment.id,
        userId: assignment.userId
      });
    }

    return activeGrants;
  }

  async listScopedActiveRoleScopeGrantsForUser(
    userId: string,
    query: ScopedRoleScopeGrantQuery
  ): Promise<ActiveRoleScopeGrant[]> {
    const activeGrants = await this.listActiveRoleScopeGrantsForUser(userId, query.asOf);
    return filterRowsByScope({
      rows: activeGrants,
      grantedScopes: query.grantedScopes,
      minimumLevel: query.minimumLevel ?? 'shop',
      getRowScope: (grant) => grant.scope
    }).allowedRows;
  }
}

function isWithinEffectiveWindow(assignment: PersistedUserScopeAssignment, asOfDate: Date): boolean {
  const effectiveFrom = new Date(assignment.effectiveFrom);
  if (Number.isNaN(effectiveFrom.valueOf()) || effectiveFrom > asOfDate) {
    return false;
  }

  if (!assignment.effectiveTo) {
    return true;
  }

  const effectiveTo = new Date(assignment.effectiveTo);
  if (Number.isNaN(effectiveTo.valueOf())) {
    return false;
  }

  return effectiveTo > asOfDate;
}
