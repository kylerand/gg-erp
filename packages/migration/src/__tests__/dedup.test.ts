import { describe, it, expect } from 'vitest';
import { findCustomerDuplicates, findAssetDuplicates, findPartDuplicates } from '../dedup/index.js';

describe('Customer deduplication', () => {
  it('finds exact email duplicates', () => {
    const records = [
      { id: 'c1', email: 'john@example.com' },
      { id: 'c2', email: 'john@example.com' },
      { id: 'c3', email: 'jane@example.com' },
    ];
    const dupes = findCustomerDuplicates(records);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].candidateAId).toBe('c1');
    expect(dupes[0].candidateBId).toBe('c2');
    expect(dupes[0].confidence).toBe(1.0);
    expect(dupes[0].matchField).toBe('email');
  });

  it('returns no duplicates when emails are unique', () => {
    const records = [
      { id: 'c1', email: 'a@example.com' },
      { id: 'c2', email: 'b@example.com' },
    ];
    expect(findCustomerDuplicates(records)).toHaveLength(0);
  });

  it('skips records with missing email', () => {
    const records = [{ id: 'c1', email: '' }, { id: 'c2', email: '' }];
    expect(findCustomerDuplicates(records)).toHaveLength(0);
  });
});

describe('Asset deduplication', () => {
  it('finds duplicate VINs', () => {
    const records = [
      { id: 'a1', vin: '1HGBH41JXMN109186' },
      { id: 'a2', vin: '1HGBH41JXMN109186' },
    ];
    const dupes = findAssetDuplicates(records);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].confidence).toBe(1.0);
  });

  it('skips assets without VIN', () => {
    const records = [{ id: 'a1', vin: undefined }, { id: 'a2', vin: undefined }];
    expect(findAssetDuplicates(records)).toHaveLength(0);
  });
});

describe('Part deduplication', () => {
  it('finds duplicate SKUs (case insensitive)', () => {
    const records = [
      { id: 'p1', sku: 'OIL-5W30' },
      { id: 'p2', sku: 'oil-5w30' },
    ];
    const dupes = findPartDuplicates(records);
    expect(dupes).toHaveLength(1);
  });
});
