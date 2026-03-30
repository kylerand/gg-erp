import type { PrismaClient } from '@prisma/client';
import { parseWorkOrdersCsv } from '../parsers/index.js';
import { mapWoStatus } from '../transformers/index.js';
import { isAlreadyImported, recordImportMapping, MIGRATION_INTEGRATION_ACCOUNT_ID } from './idempotency.js';
import { MIGRATION_SYSTEM_USER_ID } from './wave-a.loader.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

let woSequence = 0;

function nextWorkOrderNumber(): string {
  woSequence++;
  return `WO-SM-${String(woSequence).padStart(5, '0')}`;
}

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
        const status = mapWoStatus(wo.status);
        const workOrderNumber = nextWorkOrderNumber();
        const correlationId = `migration:wave-e:${batchId}`;

        const custMapping = await prisma.$queryRaw<Array<{ entity_id: string }>>`
          SELECT entity_id FROM integrations.external_id_mappings
          WHERE integration_account_id = CAST(${MIGRATION_INTEGRATION_ACCOUNT_ID} AS uuid)
            AND namespace = 'shopmonkey:v1'
            AND entity_type = 'CUSTOMER'
            AND external_id = ${wo.customerId}
        `;
        const customerReference = custMapping[0]?.entity_id ?? null;
        if (!customerReference) {
          await recordError(prisma, batchId, 'LOAD', 'MISSING_FK', `Customer ${wo.customerId} not mapped`);
          errorCount++;
          continue;
        }

        const priority = wo.priority ? parseInt(wo.priority, 10) : 3;

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO work_orders.work_orders
            (work_order_number, title, description, status, priority,
             customer_reference, created_by_user_id, correlation_id,
             opened_at, created_at, updated_at, version)
          VALUES (
            ${workOrderNumber}, ${wo.title}, ${wo.description ?? null},
            ${status}::"work_orders"."WoStatus", ${priority},
            ${customerReference}, CAST(${MIGRATION_SYSTEM_USER_ID} AS uuid),
            ${correlationId},
            ${wo.createdAt ? new Date(wo.createdAt) : new Date()},
            NOW(), NOW(), 0
          )
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
