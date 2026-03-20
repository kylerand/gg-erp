import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SanitizedOrder } from '../sanitize/sanitize-export.js';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport, SmService, SmServicePart } from '../connectors/shopmonkey-api.connector.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';
import { MIGRATION_SYSTEM_USER_ID } from './wave-a.loader.js';

export { MIGRATION_SYSTEM_USER_ID };

/** Valid WoStatus values from the Prisma enum. */
const VALID_WO_STATUSES = new Set(['DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']);

/**
 * Wave G — All Work Orders.
 *
 * Loads ALL SmOrder records from the ShopMonkey JSON export
 * into work_orders.work_orders, plus:
 *   - one WoOperation per SmService (labor line)
 *   - one WoPartLine per SmServicePart
 *
 * Skips orders where the customer reference cannot be resolved — those must
 * have been loaded in Wave D first.
 *
 * sourceFile: path to shopmonkey-export-<ts>.json
 */
export async function runWaveG(
  prisma: PrismaClient,
  sourceFile: string,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'G', sourceFile);

  const raw = await readFile(sourceFile, 'utf8');
  const exportData: ShopMonkeyExport = JSON.parse(raw);
  const report = sanitizeExport(exportData, sourceFile);

  // Import ALL non-skipped orders
  const orders: SanitizedOrder[] = report.orders.filter(o => !o.skip);

  let inserted = 0;
  let skipped = 0;
  let errorCount = 0;

  for (const order of orders) {
    try {
      if (await isAlreadyImported(prisma, 'WORK_ORDER', order.smId)) {
        skipped++;
        continue;
      }

      await recordRawRecord(prisma, batchId, 'WORK_ORDER', order.smId, order);

      if (!dryRun) {
        // Resolve customer reference (Wave D must have run)
        let customerRef: string | null = null;
        if (order.smCustomerId) {
          const custMapping = await prisma.$queryRaw<Array<{ entity_id: string }>>`
            SELECT entity_id FROM integrations.external_id_mappings
            WHERE namespace = 'shopmonkey:v1'
              AND entity_type = 'CUSTOMER'
              AND external_id = ${order.smCustomerId}
          `;
          if (custMapping[0]) {
            customerRef = custMapping[0].entity_id;
          }
        }

        // Resolve asset reference (optional — Wave D assets)
        let assetRef: string | null = null;
        if (order.smVehicleId) {
          const assetMapping = await prisma.$queryRaw<Array<{ entity_id: string }>>`
            SELECT entity_id FROM integrations.external_id_mappings
            WHERE namespace = 'shopmonkey:v1'
              AND entity_type = 'ASSET'
              AND external_id = ${order.smVehicleId}
          `;
          assetRef = assetMapping[0]?.entity_id ?? null;
        }

        // Resolve shop location (Wave A must have run)
        const locationMapping = await prisma.$queryRaw<Array<{ entity_id: string }>>`
          SELECT entity_id FROM integrations.external_id_mappings
          WHERE namespace = 'shopmonkey:v1'
            AND entity_type = 'LOCATION'
            AND external_id = 'GG-MAIN'
        `;
        const locationId = locationMapping[0]?.entity_id ?? null;

        // Fall back to the ShopMonkey ID as the reference string if Wave D hasn't run.
        // customerReference is nullable text — can be resolved later when Wave D runs.
        if (!customerRef && order.smCustomerId) {
          customerRef = `sm:${order.smCustomerId}`;
        }

        const woNumber = order.orderNumber ?? `SM-${order.smId.slice(0, 8)}`;
        const title = [
          order.orderNumber ? `Order #${order.orderNumber}` : null,
          assetRef ? null : order.smVehicleId ? `(vehicle: ${order.smVehicleId})` : null,
        ].filter(Boolean).join(' ') || woNumber;

        // Validate and default the WoStatus
        const woStatus = VALID_WO_STATUSES.has(order.status ?? '') ? order.status! : 'DRAFT';
        const isCompleted = woStatus === 'COMPLETED' || woStatus === 'CANCELLED';

        const woResult = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO work_orders.work_orders
            (work_order_number, customer_reference, asset_reference, title,
             status, stock_location_id,
             opened_at, completed_at,
             created_by_user_id, correlation_id,
             created_at, updated_at, version)
          VALUES
            (${woNumber}, ${customerRef}, ${assetRef},
             ${title},
             ${woStatus}::"work_orders"."WoStatus",
             CAST(${locationId} AS uuid),
             ${order.createdDate ? new Date(order.createdDate) : new Date()},
             ${isCompleted && order.completedDate ? new Date(order.completedDate) : null},
             CAST(${MIGRATION_SYSTEM_USER_ID} AS uuid),
             ${randomUUID()},
             NOW(), NOW(), 0)
          ON CONFLICT (work_order_number) DO NOTHING
          RETURNING id
        `;

        if (!woResult[0]) {
          // Duplicate work order number — skip gracefully
          skipped++;
          continue;
        }

        const woId = woResult[0].id;
        await recordImportMapping(prisma, 'WORK_ORDER', order.smId, woId);

        // Load service lines (operations + parts) from nested services array
        const smOrder = exportData.orders.find(o => o.id === order.smId);
        const services: SmService[] = smOrder?.services ?? [];

        for (let seqNo = 0; seqNo < services.length; seqNo++) {
          const svc = services[seqNo];
          const opName = svc.name?.trim() || `Service ${seqNo + 1}`;
          const laborMinutes = svc.labors?.reduce(
            (sum, l) => sum + Math.round((l.hours ?? 1) * 60),
            0,
          ) ?? 60;

          const opStatus = isCompleted ? 'DONE' : 'PENDING';

          const opResult = await prisma.$queryRaw<Array<{ id: string }>>`
            INSERT INTO work_orders.work_order_operations
              (work_order_id, operation_code, sequence_no, operation_name,
               estimated_minutes, operation_status,
               created_at, updated_at, version)
            VALUES
              (CAST(${woId} AS uuid), ${svc.id ?? `svc-${seqNo}`}, ${seqNo + 1},
               ${opName}, ${laborMinutes}, ${opStatus}::"work_orders"."WoOperationStatus",
               NOW(), NOW(), 0)
            RETURNING id
          `;

          const opId = opResult[0]?.id;

          // Create part lines for each part on the service
          const parts: SmServicePart[] = svc.parts ?? [];
          for (const part of parts) {
            // Resolve part FK from inventory (Wave C)
            let partId: string | null = null;
            if (part.inventoryPartId) {
              const partMapping = await prisma.$queryRaw<Array<{ entity_id: string }>>`
                SELECT entity_id FROM integrations.external_id_mappings
                WHERE namespace = 'shopmonkey:v1'
                  AND entity_type = 'PART'
                  AND external_id = ${part.inventoryPartId}
              `;
              partId = partMapping[0]?.entity_id ?? null;
            }

            if (!partId) continue; // skip unresolved parts

            const partStatus = isCompleted ? 'CONSUMED' : 'REQUESTED';
            await prisma.$executeRaw`
              INSERT INTO work_orders.work_order_parts
                (work_order_id, work_order_operation_id, part_id,
                 requested_quantity, consumed_quantity, part_status,
                 correlation_id, created_at, updated_at, version)
              VALUES
                (CAST(${woId} AS uuid), CAST(${opId ?? null} AS uuid), CAST(${partId} AS uuid),
                 ${part.quantity ?? 1}, ${isCompleted ? (part.quantity ?? 1) : 0}, ${partStatus}::"work_orders"."WoPartStatus",
                 ${randomUUID()}, NOW(), NOW(), 0)
              ON CONFLICT DO NOTHING
            `;
          }
        }
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

  await completeBatch(prisma, batchId, orders.length, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'G', inserted, skipped, errors: errorCount };
}
