import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderState } from '../../../../packages/domain/src/model/buildPlanning.js';
import {
  validateCreateWorkOrderRequest,
  validateListWorkOrdersQuery,
} from '../contexts/build-planning/workOrder.validation.js';

test('validateCreateWorkOrderRequest requires mandatory fields', () => {
  const result = validateCreateWorkOrderRequest({
    workOrderNumber: '  ',
    vehicleId: '',
    buildConfigurationId: '',
    bomId: '',
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === 'workOrderNumber'));
  assert.ok(result.issues.some((issue) => issue.field === 'vehicleId'));
  assert.ok(result.issues.some((issue) => issue.field === 'buildConfigurationId'));
  assert.ok(result.issues.some((issue) => issue.field === 'bomId'));
});

test('validateListWorkOrdersQuery enforces pagination constraints', () => {
  const result = validateListWorkOrdersQuery({
    limit: 0,
    offset: -1,
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === 'limit'));
  assert.ok(result.issues.some((issue) => issue.field === 'offset'));
});

test('validateListWorkOrdersQuery accepts valid query', () => {
  const result = validateListWorkOrdersQuery({
    state: WorkOrderState.PLANNED,
    limit: 25,
    offset: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
});
