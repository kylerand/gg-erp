import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawCustomerRow } from '../types.js';

// email is intentionally NOT required — many walk-in customers provide only a phone number.
// Rows missing email are still imported; the field is nullable in the ERP schema.
const REQUIRED_COLUMNS = ['id', 'firstName', 'lastName'];

export async function parseCustomersCsv(filePath: string): Promise<ParseResult<RawCustomerRow>> {
  return parseCsvFile<RawCustomerRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) {
        return { row: rowNum, field: 'id', message: 'id is required' };
      }
      return {
        id: row.id.trim(),
        firstName: row.firstName?.trim() ?? '',
        lastName: row.lastName?.trim() ?? '',
        email: row.email.trim().toLowerCase(),
        phone: row.phone?.trim() || undefined,
        address: row.address?.trim() || undefined,
        city: row.city?.trim() || undefined,
        state: row.state?.trim() || undefined,
        zip: row.zip?.trim() || undefined,
        createdAt: row.createdAt?.trim() || undefined,
      };
    },
  );
}
