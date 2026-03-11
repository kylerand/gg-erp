import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawCustomerRow } from '../types.js';

const REQUIRED_COLUMNS = ['id', 'firstName', 'lastName', 'email'];

export async function parseCustomersCsv(filePath: string): Promise<ParseResult<RawCustomerRow>> {
  return parseCsvFile<RawCustomerRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) {
        return { row: rowNum, field: 'id', message: 'id is required' };
      }
      if (!row.email?.trim()) {
        return { row: rowNum, field: 'email', message: 'email is required', rawValue: row.id };
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
