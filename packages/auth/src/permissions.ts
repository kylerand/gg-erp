export const APP_PERMISSIONS = [
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
] as const;

export type Permission = (typeof APP_PERMISSIONS)[number];

const PERMISSION_LOOKUP: ReadonlySet<string> = new Set(APP_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_LOOKUP.has(value);
}
