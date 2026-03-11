import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseCustomersCsv,
  parseAssetsCsv,
  parseWorkOrdersCsv,
} from '../parsers/index.js';

function writeTempCsv(name: string, content: string): string {
  const dir = join(tmpdir(), 'gg-erp-migration-tests');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

describe('Customer CSV parser', () => {
  it('parses valid customer CSV', async () => {
    const path = writeTempCsv('customers.csv',
      'id,firstName,lastName,email,phone\n' +
      'c1,John,Doe,john@example.com,555-1234\n'
    );
    const result = await parseCustomersCsv(path);
    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].email).toBe('john@example.com');
    expect(result.records[0].phone).toBe('555-1234');
  });

  it('normalizes email to lowercase', async () => {
    const path = writeTempCsv('customers-case.csv',
      'id,firstName,lastName,email\n' +
      'c1,Jane,Smith,JANE@EXAMPLE.COM\n'
    );
    const { records } = await parseCustomersCsv(path);
    expect(records[0].email).toBe('jane@example.com');
  });

  it('returns error for missing email', async () => {
    const path = writeTempCsv('customers-noemail.csv',
      'id,firstName,lastName,email\n' +
      'c1,Bob,Jones,\n'
    );
    const { errors, records } = await parseCustomersCsv(path);
    expect(errors).toHaveLength(1);
    expect(records).toHaveLength(0);
    expect(errors[0].field).toBe('email');
  });

  it('throws on missing required columns', async () => {
    const path = writeTempCsv('customers-bad.csv',
      'firstName,lastName\nJohn,Doe\n'
    );
    await expect(parseCustomersCsv(path)).rejects.toThrow('missing required columns');
  });
});

describe('Asset CSV parser', () => {
  it('normalizes VIN to uppercase', async () => {
    const path = writeTempCsv('assets.csv',
      'id,customerId,vin\n' +
      'a1,c1,1hgbh41jxmn109186\n'
    );
    const { records } = await parseAssetsCsv(path);
    expect(records[0].vin).toBe('1HGBH41JXMN109186');
  });
});

describe('Work Order CSV parser', () => {
  it('parses work order with status', async () => {
    const path = writeTempCsv('work_orders.csv',
      'id,customerId,title,status\n' +
      'wo1,c1,Oil Change,Open\n' +
      'wo2,c1,Brake Job,In Progress\n'
    );
    const { records, errors } = await parseWorkOrdersCsv(path);
    expect(errors).toHaveLength(0);
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('Open');
    expect(records[1].status).toBe('In Progress');
  });
});
