import type { PrismaClient } from '@prisma/client';
import { parseEmployeesCsv } from '../parsers/index.js';
import { mapEmployeeRole } from '../transformers/index.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

export async function runWaveB(
  prisma: PrismaClient,
  sourceFile: string,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'B', sourceFile);
  const { records, errors: parseErrors } = await parseEmployeesCsv(sourceFile);

  let inserted = 0;
  let skipped = 0;
  let errorCount = parseErrors.length;

  for (const parseError of parseErrors) {
    await recordError(prisma, batchId, 'PARSE', 'PARSE_ERROR', parseError.message);
  }

  for (const emp of records) {
    try {
      if (await isAlreadyImported(prisma, 'EMPLOYEE', emp.id)) {
        skipped++;
        continue;
      }

      await recordRawRecord(prisma, batchId, 'EMPLOYEE', emp.id, emp);

      if (!dryRun) {
        // Insert into identity schema - using raw query to target correct schema
        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO identity.employees
            (first_name, last_name, email, role, phone, hire_date, active, created_at, updated_at)
          VALUES
            (${emp.firstName}, ${emp.lastName}, ${emp.email},
             ${mapEmployeeRole(emp.role)}, ${emp.phone ?? null},
             ${emp.hireDate ? new Date(emp.hireDate) : null},
             ${emp.active !== 'false'},
             NOW(), NOW())
          RETURNING id
        `;
        await recordImportMapping(prisma, 'EMPLOYEE', emp.id, result[0].id);
      }
      inserted++;
    } catch (err) {
      errorCount++;
      await recordError(
        prisma, batchId, 'LOAD', 'INSERT_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await completeBatch(prisma, batchId, records.length, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'B', inserted, skipped, errors: errorCount };
}
