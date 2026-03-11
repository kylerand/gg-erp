import assert from 'node:assert/strict';
import test from 'node:test';
import { isPermission } from '../permissions.js';
import {
  APP_PERMISSIONS,
  APP_ROLES,
  ROLE_PERMISSION_MATRIX,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  permissionsForRole,
  permissionsForRoles
} from '../rbac.js';
import { isRole, normalizeRoles } from '../roles.js';

test('rbac matrix contains explicit entries for every declared role', () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSION_MATRIX).sort(), [...APP_ROLES].sort());

  for (const role of APP_ROLES) {
    assert.ok(ROLE_PERMISSION_MATRIX[role].length > 0, `${role} should have at least one permission`);
  }
});

test('admin role receives the full permission set', () => {
  assert.deepEqual([...permissionsForRole('admin')].sort(), [...APP_PERMISSIONS].sort());
});

test('role checks allow expected capabilities and deny missing permissions', () => {
  assert.equal(hasPermission(['shop_manager'], 'work_orders:assign'), true);
  assert.equal(hasPermission(['technician'], 'work_orders:write'), true);
  assert.equal(hasPermission(['sales'], 'sales_quotes:write'), true);

  assert.equal(hasPermission(['technician'], 'accounting:write'), false);
  assert.equal(hasPermission(['read_only_executive'], 'customers:write'), false);
  assert.equal(hasPermission(['accounting'], 'users:manage'), false);
});

test('unknown roles are ignored in role-list permission checks', () => {
  assert.equal(hasPermission(['unknown-role', 'sales'], 'customers:write'), true);
  assert.equal(hasPermission(['unknown-role'], 'customers:read'), false);
});

test('permissionsForRoles deduplicates role grants', () => {
  assert.deepEqual(
    permissionsForRoles(['sales', 'sales', 'not-a-role']).sort(),
    [
      'work_orders:read',
      'inventory:read',
      'customers:read',
      'customers:write',
      'sales_quotes:read',
      'sales_quotes:write',
      'reports:read'
    ].sort()
  );
});

test('batch permission checks cover positive and edge cases', () => {
  assert.equal(
    hasAnyPermission(['parts_manager'], ['inventory:write', 'accounting:write']),
    true
  );
  assert.equal(
    hasAllPermissions(['parts_manager'], ['inventory:write', 'accounting:write']),
    false
  );
  assert.equal(hasAnyPermission(['sales'], []), false);
  assert.equal(hasAllPermissions(['sales'], []), false);
});

test('role and permission guard helpers validate known values', () => {
  assert.equal(isRole('shop_manager'), true);
  assert.equal(isRole('planner'), false);
  assert.deepEqual(normalizeRoles(['sales', 'sales', 'planner']), ['sales']);

  assert.equal(isPermission('training:write'), true);
  assert.equal(isPermission('training:delete'), false);
});
