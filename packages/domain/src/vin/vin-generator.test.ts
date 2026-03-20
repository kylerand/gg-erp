import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCheckDigit,
  generateVin,
  modelYearToCode,
} from './vin-generator.js';

describe('modelYearToCode', () => {
  it('returns correct codes for known years', () => {
    assert.equal(modelYearToCode(2024), 'R');
    assert.equal(modelYearToCode(2025), 'S');
    assert.equal(modelYearToCode(2026), 'T');
    assert.equal(modelYearToCode(2010), 'A');
    assert.equal(modelYearToCode(2039), '9');
  });

  it('throws for unsupported years', () => {
    assert.throws(() => modelYearToCode(2009), /Unsupported model year/);
    assert.throws(() => modelYearToCode(2040), /Unsupported model year/);
    assert.throws(() => modelYearToCode(1999), /Unsupported model year/);
  });
});

describe('computeCheckDigit', () => {
  it('computes check digit for known GolfinGarage VINs', () => {
    // Known valid VINs from production — check digit is position 9 (index 8)
    const knownVins: Array<{ vin: string; expectedCheck: string }> = [
      { vin: '1F9RUD1A0RJ540047', expectedCheck: '0' },
      { vin: '1F9RUD1A9RJ540029', expectedCheck: '9' },
      { vin: '1F9RUD1A3RJ540026', expectedCheck: '3' },
      // Note: '1F9RUD1A5TJ540101' from source data has a data-entry error (correct check digit is '3')
      { vin: '1F9RUD1A9SJ540036', expectedCheck: '9' },
      { vin: '1F9RUD1A1SJ540015', expectedCheck: '1' },
      { vin: '1F9RUD1AXSJ540028', expectedCheck: 'X' },
      { vin: '1F9RUD1A8SJ540030', expectedCheck: '8' },
    ];

    for (const { vin, expectedCheck } of knownVins) {
      assert.equal(
        computeCheckDigit(vin),
        expectedCheck,
        `Check digit mismatch for VIN ${vin}`,
      );
    }
  });

  it('throws for VINs that are not 17 characters', () => {
    assert.throws(() => computeCheckDigit('1F9RUD1A0RJ54004'), /17 characters/);
    assert.throws(() => computeCheckDigit('1F9RUD1A0RJ5400470'), /17 characters/);
  });

  it('throws for invalid characters', () => {
    // 'I' is not a valid VIN character
    assert.throws(() => computeCheckDigit('IF9RUD1A0RJ540047'), /Invalid VIN character/);
  });
});

describe('generateVin', () => {
  it('generates a valid 17-character VIN', () => {
    const vin = generateVin(2024, 540047);
    assert.equal(vin.length, 17);
    assert.equal(vin, '1F9RUD1A0RJ540047');
  });

  it('matches all known production VINs', () => {
    const cases: Array<{ modelYear: number; seq: number; expected: string }> = [
      { modelYear: 2024, seq: 540047, expected: '1F9RUD1A0RJ540047' },
      { modelYear: 2024, seq: 540029, expected: '1F9RUD1A9RJ540029' },
      { modelYear: 2024, seq: 540026, expected: '1F9RUD1A3RJ540026' },
      // Note: source VIN '1F9RUD1A5TJ540101' had a data-entry error; correct check digit is '3'
      { modelYear: 2026, seq: 540101, expected: '1F9RUD1A3TJ540101' },
      { modelYear: 2025, seq: 540036, expected: '1F9RUD1A9SJ540036' },
      { modelYear: 2025, seq: 540015, expected: '1F9RUD1A1SJ540015' },
      { modelYear: 2025, seq: 540028, expected: '1F9RUD1AXSJ540028' },
      { modelYear: 2025, seq: 540030, expected: '1F9RUD1A8SJ540030' },
    ];

    for (const { modelYear, seq, expected } of cases) {
      assert.equal(
        generateVin(modelYear, seq),
        expected,
        `VIN mismatch for modelYear=${modelYear}, seq=${seq}`,
      );
    }
  });

  it('zero-pads sequence numbers', () => {
    const vin = generateVin(2025, 1);
    assert.equal(vin.slice(11), '000001');
  });

  it('encodes model year at position 10', () => {
    assert.equal(generateVin(2024, 1)[9], 'R');
    assert.equal(generateVin(2025, 1)[9], 'S');
    assert.equal(generateVin(2026, 1)[9], 'T');
  });

  it('always uses WMI 1F9 and plant J', () => {
    const vin = generateVin(2025, 100);
    assert.equal(vin.slice(0, 3), '1F9');
    assert.equal(vin[10], 'J');
  });

  it('throws for out-of-range sequence numbers', () => {
    assert.throws(() => generateVin(2025, 0), /Sequence number/);
    assert.throws(() => generateVin(2025, 1_000_000), /Sequence number/);
  });

  it('throws for unsupported model year', () => {
    assert.throws(() => generateVin(2009, 1), /Unsupported model year/);
  });
});
