import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawVendorRow } from '../types.js';

const REQUIRED_COLUMNS = ['id', 'name'];

export async function parseVendorsCsv(filePath: string): Promise<ParseResult<RawVendorRow>> {
  return parseCsvFile<RawVendorRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.name?.trim()) return { row: rowNum, field: 'name', message: 'name is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        name: row.name.trim(),
        contactName: row.contactName?.trim() || undefined,
        email: row.email?.trim().toLowerCase() || undefined,
        phone: row.phone?.trim() || undefined,
        address: row.address?.trim() || undefined,
        accountNumber: row.accountNumber?.trim() || undefined,
      };
    },
  );
}
