import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawPartRow } from '../types.js';

const REQUIRED_COLUMNS = ['id', 'sku', 'name'];

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase().replace(/\s+/g, '-');
}

export async function parsePartsCsv(filePath: string): Promise<ParseResult<RawPartRow>> {
  return parseCsvFile<RawPartRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.sku?.trim()) return { row: rowNum, field: 'sku', message: 'sku is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        sku: normalizeSku(row.sku),
        name: row.name?.trim() ?? '',
        description: row.description?.trim() || undefined,
        category: row.category?.trim() || undefined,
        unitPrice: row.unitPrice?.trim() || undefined,
        costPrice: row.costPrice?.trim() || undefined,
        unitOfMeasure: row.unitOfMeasure?.trim() || undefined,
        vendorId: row.vendorId?.trim() || undefined,
      };
    },
  );
}
