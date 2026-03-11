import type { PrismaClient } from '@prisma/client';
import { parseWorkOrdersCsv } from '../parsers/index.js';
import { mapWorkOrderStatus } from '../transformers/index.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

export async function runWaveE(
  prisma: PrismaClient,
  workOrdersCsvPath: string,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'E', workOrdersCsvPath);
  const { records, errors: parseErrors } = await parseWorkOrdersCsv(workOrdersCsvPath);
  let inserted = 0, skipped = 0, errorCount = parseErrors.length;

  for (const parseError of parseErrors) {
    await recordError(prisma, batchId, 'PARSE', 'PARSE_ERROR', parseError.message);
  }

  for (const wo of records) {
    try {
      if (await isAlreadyImported(prisma, 'WORK_ORDER', wo.id)) { skipped++; continue; }
      await recordRawRecord(prisma, batchId, 'WORK_ORDER', wo.id, wo);

      if (!dryRun) {
        const status = mapWorkOrderStatus(wo.status);

        const custMapping = await prisma.$queryRaw<Array<{ internal_id: string }>>`
          SELECT internal_id FROM integrations.external_id_mappings
          WHERE namespace = 'shopmonkey:v1' AND entity_type = 'CUSTOMER' AND external_id = ${wo.customerId}
        `;
        if (!custMapping[0]) {
          await recordError(prisma, batchId, 'LOAD', 'MISSING_FK', `Customer ${wo.customerId} not mapped`);
          errorCount++;
          continue;
        }

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO planning.work_orders
            (title, description, status, customer_id, created_at, updated_at)
          VALUES (${wo.title}, ${wo.description ?? null}, ${status}::"planning"."WorkOrderStatus",
                  ${custMapping[0].internal_id}, NOW(), NOW())
          RETURNING id
        `;
        await recordImportMapping(prisma, 'WORK_ORDER', wo.id, result[0].id);
      }
      inserted++;
    } catch (err) {
      errorCount++;
      await recordError(prisma, batchId, 'LOAD', 'INSERT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  await completeBatch(prisma, batchId, records.length, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'E', inserted, skipped, errors: errorCount };
}
