import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_ENTITY_DESIGNS,
  CANONICAL_API_OPERATIONS
} from '../../../../packages/domain/src/model/apiOperations.js';

const requiredEntities = [
  'Customer',
  'CartVehicle',
  'BuildConfiguration',
  'PartSku',
  'InventoryLot',
  'InventoryBin',
  'InventoryLocation',
  'Vendor',
  'PurchaseOrder',
  'BOM',
  'RoutingSopStep',
  'WorkOrder',
  'TechnicianTask',
  'TicketReworkIssue',
  'BuildSlot',
  'LaborCapacity',
  'InvoiceSyncRecord',
  'FileAttachment',
  'AuditEvent'
] as const;

test('canonical model includes all required entities with metadata', () => {
  for (const entityName of requiredEntities) {
    const design = CANONICAL_ENTITY_DESIGNS[entityName];
    assert.ok(design, `Missing design for ${entityName}`);
    assert.ok(design.keyFields.length > 0, `${entityName} missing keyFields`);
    assert.ok(design.requiredIndexes.length > 0, `${entityName} missing requiredIndexes`);
    assert.ok(design.businessRules.length > 0, `${entityName} missing businessRules`);
    assert.ok(design.emittedEvents.length > 0, `${entityName} missing emittedEvents`);
    assert.ok(design.apiOperations.length > 0, `${entityName} missing apiOperations`);
  }
});

test('canonical API operations are generated for all entities', () => {
  const operationsByEntity = new Set(CANONICAL_API_OPERATIONS.map((operation) => operation.entity));
  for (const entityName of requiredEntities) {
    assert.ok(
      operationsByEntity.has(entityName),
      `Missing API operations for ${entityName}`
    );
  }
});
