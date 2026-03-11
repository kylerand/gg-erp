import { describe, it, expect } from 'vitest';
import { mapWorkOrderStatus, mapEmployeeRole } from '../transformers/index.js';

describe('Work order status mapping', () => {
  it.each([
    ['Open', 'PLANNED'],
    ['Estimate', 'PLANNED'],
    ['In Progress', 'IN_PROGRESS'],
    ['Pending Parts', 'BLOCKED'],
    ['Pending Customer', 'BLOCKED'],
    ['Complete', 'COMPLETED'],
    ['Invoiced', 'COMPLETED'],
    ['Paid', 'COMPLETED'],
    ['Cancelled', 'COMPLETED'],
  ])('maps ShopMonkey "%s" → ERP "%s"', (input, expected) => {
    expect(mapWorkOrderStatus(input)).toBe(expected);
  });

  it('defaults unknown status to PLANNED', () => {
    expect(mapWorkOrderStatus('UnknownStatus')).toBe('PLANNED');
  });
});

describe('Employee role mapping', () => {
  it.each([
    ['Admin', 'MANAGER'],
    ['Manager', 'MANAGER'],
    ['Technician', 'TECHNICIAN'],
    ['Service Advisor', 'SERVICE_ADVISOR'],
    ['Parts', 'PARTS_SPECIALIST'],
  ])('maps ShopMonkey "%s" → ERP "%s"', (input, expected) => {
    expect(mapEmployeeRole(input)).toBe(expected);
  });

  it('defaults unknown role to TECHNICIAN', () => {
    expect(mapEmployeeRole('Unknown')).toBe('TECHNICIAN');
  });
});
