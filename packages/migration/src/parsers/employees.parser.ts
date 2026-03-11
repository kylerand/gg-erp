import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawEmployeeRow } from '../types.js';

const REQUIRED_COLUMNS = ['id', 'firstName', 'lastName', 'email', 'role'];

export async function parseEmployeesCsv(filePath: string): Promise<ParseResult<RawEmployeeRow>> {
  return parseCsvFile<RawEmployeeRow>(
    filePath,
    REQUIRED_COLUMNS,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.email?.trim()) return { row: rowNum, field: 'email', message: 'email is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        firstName: row.firstName?.trim() ?? '',
        lastName: row.lastName?.trim() ?? '',
        email: row.email.trim().toLowerCase(),
        role: row.role?.trim() ?? 'TECHNICIAN',
        phone: row.phone?.trim() || undefined,
        hireDate: row.hireDate?.trim() || undefined,
        active: row.active?.trim() || undefined,
      };
    },
  );
}
