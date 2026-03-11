export const APP_ROLES = [
  'admin',
  'shop_manager',
  'technician',
  'parts_manager',
  'sales',
  'accounting',
  'trainer_ojt_lead',
  'read_only_executive'
] as const;

export type Role = (typeof APP_ROLES)[number];

const ROLE_LOOKUP: ReadonlySet<string> = new Set(APP_ROLES);

export function isRole(value: string): value is Role {
  return ROLE_LOOKUP.has(value);
}

export function normalizeRoles(roles: readonly string[]): Role[] {
  const knownRoles = new Set<Role>();

  for (const role of roles) {
    if (isRole(role)) {
      knownRoles.add(role);
    }
  }

  return [...knownRoles];
}
