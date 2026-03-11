import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawAssetRow } from '../types.js';

const REQUIRED_COLUMNS = ['id', 'customerId'];

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
}

export async function parseAssetsCsv(filePath: string): Promise<ParseResult<RawAssetRow>> {
  return parseCsvFile<RawAssetRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) {
        return { row: rowNum, field: 'id', message: 'id is required' };
      }
      if (!row.customerId?.trim()) {
        return { row: rowNum, field: 'customerId', message: 'customerId is required', rawValue: row.id };
      }
      const vin = row.vin?.trim() ? normalizeVin(row.vin) : undefined;
      return {
        id: row.id.trim(),
        customerId: row.customerId.trim(),
        vin: vin || undefined,
        year: row.year?.trim() || undefined,
        make: row.make?.trim() || undefined,
        model: row.model?.trim() || undefined,
        color: row.color?.trim() || undefined,
        licensePlate: row.licensePlate?.trim() || undefined,
        mileage: row.mileage?.trim() || undefined,
      };
    },
  );
}
