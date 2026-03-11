import type { Permission } from './permissions.js';
import type { Role } from './roles.js';
import { normalizeRoles } from './roles.js';

export { APP_PERMISSIONS, isPermission } from './permissions.js';
export type { Permission } from './permissions.js';
export { APP_ROLES, isRole } from './roles.js';
export type { Role } from './roles.js';

export const ROLE_PERMISSION_MATRIX: Readonly<Record<Role, readonly Permission[]>> = {
  admin: [
    'users:manage',
    'work_orders:read',
    'work_orders:write',
    'work_orders:assign',
    'inventory:read',
    'inventory:write',
    'parts_orders:read',
    'parts_orders:write',
    'customers:read',
    'customers:write',
    'sales_quotes:read',
    'sales_quotes:write',
    'accounting:read',
    'accounting:write',
    'training:read',
    'training:write',
    'reports:read'
  ],
  shop_manager: [
    'work_orders:read',
    'work_orders:write',
    'work_orders:assign',
    'inventory:read',
    'inventory:write',
    'parts_orders:read',
    'parts_orders:write',
    'customers:read',
    'customers:write',
    'sales_quotes:read',
    'sales_quotes:write',
    'accounting:read',
    'training:read',
    'reports:read'
  ],
  technician: [
    'work_orders:read',
    'work_orders:write',
    'inventory:read',
    'parts_orders:read',
    'training:read'
  ],
  parts_manager: [
    'work_orders:read',
    'inventory:read',
    'inventory:write',
    'parts_orders:read',
    'parts_orders:write',
    'reports:read'
  ],
  sales: [
    'work_orders:read',
    'inventory:read',
    'customers:read',
    'customers:write',
    'sales_quotes:read',
    'sales_quotes:write',
    'reports:read'
  ],
  accounting: ['customers:read', 'sales_quotes:read', 'accounting:read', 'accounting:write', 'reports:read'],
  trainer_ojt_lead: ['work_orders:read', 'inventory:read', 'training:read', 'training:write', 'reports:read'],
  read_only_executive: [
    'work_orders:read',
    'inventory:read',
    'parts_orders:read',
    'customers:read',
    'sales_quotes:read',
    'accounting:read',
    'training:read',
    'reports:read'
  ]
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSION_MATRIX[role];
}

export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const grantedPermissions = new Set<Permission>();

  for (const role of normalizeRoles(roles)) {
    for (const permission of ROLE_PERMISSION_MATRIX[role]) {
      grantedPermissions.add(permission);
    }
  }

  return [...grantedPermissions];
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsForRoles(roles).includes(permission);
}

export function hasAnyPermission(
  roles: readonly string[],
  permissions: readonly Permission[]
): boolean {
  if (permissions.length === 0) {
    return false;
  }

  const grantedPermissions = new Set(permissionsForRoles(roles));
  return permissions.some((permission) => grantedPermissions.has(permission));
}

export function hasAllPermissions(
  roles: readonly string[],
  permissions: readonly Permission[]
): boolean {
  if (permissions.length === 0) {
    return false;
  }

  const grantedPermissions = new Set(permissionsForRoles(roles));
  return permissions.every((permission) => grantedPermissions.has(permission));
}
