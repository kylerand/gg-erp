import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FLOOR_HANDOFF_PATH,
  sanitizeErpReturnUrl,
  sanitizeFloorNextPath,
} from './handoff';

test('sanitizeFloorNextPath keeps same-app paths with query and hash', () => {
  assert.equal(
    sanitizeFloorNextPath('/work-orders/my-queue?view=today#next'),
    '/work-orders/my-queue?view=today#next',
  );
});

test('sanitizeFloorNextPath rejects external or malformed destinations', () => {
  for (const input of [
    null,
    '',
    'https://evil.example/work-orders/my-queue',
    '//evil.example/work-orders/my-queue',
    'javascript:alert(1)',
  ]) {
    assert.equal(sanitizeFloorNextPath(input), DEFAULT_FLOOR_HANDOFF_PATH);
  }
});

test('sanitizeErpReturnUrl only allows the ERP origins used by production and local QA', () => {
  assert.equal(
    sanitizeErpReturnUrl('https://golfingarage.m4nos.com/work-orders/dispatch'),
    'https://golfingarage.m4nos.com/work-orders/dispatch',
  );
  assert.equal(
    sanitizeErpReturnUrl('http://localhost:3000/inventory/planning?view=replenishment'),
    'http://localhost:3000/inventory/planning?view=replenishment',
  );
  assert.equal(sanitizeErpReturnUrl('https://evil.example/accounting'), null);
  assert.equal(sanitizeErpReturnUrl('/relative-path'), null);
});

test('sanitizeErpReturnUrl accepts explicitly configured ERP origins', () => {
  assert.equal(
    sanitizeErpReturnUrl('https://erp.example.test/accounting', ['https://erp.example.test']),
    'https://erp.example.test/accounting',
  );
});
