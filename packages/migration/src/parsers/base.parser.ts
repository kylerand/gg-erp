import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { ParseResult, ParseError } from '../types.js';

export async function parseCsvFile<T>(
  filePath: string,
  requiredColumns: string[],
  rowMapper: (row: Record<string, string>, rowNum: number) => T | ParseError,
): Promise<ParseResult<T>> {
  const errors: ParseError[] = [];
  const records: T[] = [];
  let headers: string[] = [];
  let rowNum = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    rowNum++;

    if (rowNum === 1) {
      headers = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const missing = requiredColumns.filter(c => !headers.includes(c));
      if (missing.length > 0) {
        throw new Error(`CSV missing required columns: ${missing.join(', ')}`);
      }
      continue;
    }

    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i]?.trim() ?? '';
    });

    const result = rowMapper(row, rowNum);
    if (isParseError(result)) {
      errors.push(result);
    } else {
      records.push(result as T);
    }
  }

  return { records, errors, totalRows: rowNum - 1 };
}

function isParseError(value: unknown): value is ParseError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ParseError).row === 'number' &&
    typeof (value as ParseError).message === 'string'
  );
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
