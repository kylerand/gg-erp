import { createReadStream } from 'fs';
import { createInterface } from 'readline';

export interface PreLoadReport {
  file: string;
  totalRows: number;
  parseErrors: number;
  missingRequiredFields: string[];
  status: 'OK' | 'WARN' | 'FAIL';
}

export async function countCsvRows(filePath: string): Promise<number> {
  let count = 0;
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const _ of rl) count++;
  return Math.max(0, count - 1); // subtract header row
}

export async function validateCsvContract(
  filePath: string,
  requiredColumns: string[],
): Promise<PreLoadReport> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let firstLine = true;
  let headers: string[] = [];
  let totalRows = 0;

  for await (const line of rl) {
    if (firstLine) {
      headers = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      firstLine = false;
      continue;
    }
    if (line.trim()) totalRows++;
  }

  const missing = requiredColumns.filter(c => !headers.includes(c));

  return {
    file: filePath,
    totalRows,
    parseErrors: 0,
    missingRequiredFields: missing,
    status: missing.length > 0 ? 'FAIL' : 'OK',
  };
}
