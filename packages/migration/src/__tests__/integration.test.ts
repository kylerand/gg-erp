import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseCustomersCsv, parseWorkOrdersCsv } from '../parsers/index.js';
import { mapWorkOrderStatus } from '../transformers/index.js';
import { findCustomerDuplicates } from '../dedup/index.js';

function createFixtureDir(): string {
  const dir = join(tmpdir(), 'gg-erp-migration-integration');
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Migration integration — dry run pipeline', () => {
  it('runs full parse → dedup → transform pipeline without errors', async () => {
    const dir = createFixtureDir();

    writeFileSync(join(dir, 'customers.csv'),
      'id,firstName,lastName,email,phone\n' +
      'c1,Alice,Smith,alice@example.com,555-0001\n' +
      'c2,Bob,Jones,bob@example.com,555-0002\n' +
      'c3,Alice,Smith,alice@example.com,555-0003\n'  // duplicate email
    );

    writeFileSync(join(dir, 'work_orders.csv'),
      'id,customerId,title,status\n' +
      'wo1,c1,Oil Change,Open\n' +
      'wo2,c2,Brake Job,In Progress\n' +
      'wo3,c1,Tire Rotation,Complete\n'
    );

    // Parse
    const { records: customers, errors: custErrors } = await parseCustomersCsv(join(dir, 'customers.csv'));
    expect(custErrors).toHaveLength(0);
    expect(customers).toHaveLength(3);

    const { records: workOrders } = await parseWorkOrdersCsv(join(dir, 'work_orders.csv'));
    expect(workOrders).toHaveLength(3);

    // Dedup
    const dupes = findCustomerDuplicates(customers);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].matchField).toBe('email');

    // Transform
    const mappedStatuses = workOrders.map(wo => mapWorkOrderStatus(wo.status));
    expect(mappedStatuses).toEqual(['PLANNED', 'IN_PROGRESS', 'COMPLETED']);
  });
});
