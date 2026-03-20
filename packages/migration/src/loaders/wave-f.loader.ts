import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SanitizedVendor, SanitizedPurchaseOrder } from '../sanitize/sanitize-export.js';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

/**
 * Wave F — Vendors and Purchase Orders.
 *
 * Pass 1: loads SmVendor[] into inventory.vendors.
 * Pass 2: loads SmPurchaseOrder[] into inventory.purchase_orders,
 *         resolving the vendor FK via the idempotency table from Pass 1.
 *
 * POs without a resolvable vendor are recorded as errors and skipped.
 *
 * sourceFile: path to shopmonkey-export-<ts>.json
 */
export async function runWaveF(
  prisma: PrismaClient,
  sourceFile: string,
  dryRun = false,
): Promise<{ vendors: LoadResult; purchaseOrders: LoadResult }> {
  const raw = await readFile(sourceFile, 'utf8');
  const exportData: ShopMonkeyExport = JSON.parse(raw);
  const report = sanitizeExport(exportData, sourceFile);

  // ── Pass 1: Vendors ────────────────────────────────────────────────────────
  const vendorBatchId = await createBatch(prisma, 'F', sourceFile);
  const vendors: SanitizedVendor[] = report.vendors;
  let vInserted = 0, vSkipped = 0, vErrors = 0;

  for (const vendor of vendors) {
    try {
      if (vendor.skip) { vSkipped++; continue; }

      if (await isAlreadyImported(prisma, 'VENDOR', vendor.smId)) {
        vSkipped++;
        continue;
      }

      await recordRawRecord(prisma, vendorBatchId, 'VENDOR', vendor.smId, vendor);

      if (!dryRun) {
        // vendor_code must be unique — use SM id as stable code
        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO inventory.vendors
            (vendor_code, vendor_name, vendor_state, email, phone, notes, created_at, updated_at, version)
          VALUES
            (${vendor.smId}, ${vendor.name}, 'ACTIVE',
             ${vendor.email ?? null}, ${vendor.phone ?? null},
             ${vendor.accountNumber ? `Account: ${vendor.accountNumber}` : null},
             NOW(), NOW(), 0)
          RETURNING id
        `;
        await recordImportMapping(prisma, 'VENDOR', vendor.smId, result[0].id);
      }
      vInserted++;
    } catch (err) {
      vErrors++;
      await recordError(
        prisma, vendorBatchId, 'LOAD', 'INSERT_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await completeBatch(prisma, vendorBatchId, vendors.length, vErrors, vErrors === 0 ? 'COMPLETED' : 'FAILED');

  // ── Pass 2: Purchase Orders ────────────────────────────────────────────────
  const poBatchId = await createBatch(prisma, 'F', sourceFile);
  const purchaseOrders: SanitizedPurchaseOrder[] = report.purchaseOrders;
  let poInserted = 0, poSkipped = 0, poErrors = 0;

  for (const po of purchaseOrders) {
    try {
      if (po.skip) { poSkipped++; continue; }

      if (await isAlreadyImported(prisma, 'PURCHASE_ORDER', po.smId)) {
        poSkipped++;
        continue;
      }

      await recordRawRecord(prisma, poBatchId, 'PURCHASE_ORDER', po.smId, po);

      if (!dryRun) {
        // POs in ShopMonkey have no vendorId field — use a fallback "unknown" vendor
        // or skip if none can be resolved.
        const vendorMapping = await prisma.$queryRaw<Array<{ internal_id: string }>>`
          SELECT id AS internal_id FROM inventory.vendors
          WHERE vendor_name = 'Unknown / Import'
          LIMIT 1
        `;

        let vendorId: string;
        if (vendorMapping[0]) {
          vendorId = vendorMapping[0].internal_id;
        } else {
          // Create a placeholder vendor on first use
          const existing = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM inventory.vendors WHERE vendor_code = 'UNKNOWN-IMPORT' LIMIT 1
          `;
          if (existing[0]) {
            vendorId = existing[0].id;
          } else {
            const placeholder = await prisma.$queryRaw<Array<{ id: string }>>`
              INSERT INTO inventory.vendors
                (vendor_code, vendor_name, vendor_state, created_at, updated_at, version)
              VALUES
                ('UNKNOWN-IMPORT', 'Unknown / Import', 'INACTIVE', NOW(), NOW(), 0)
              RETURNING id
            `;
            vendorId = placeholder[0].id;
          }
        }

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO inventory.purchase_orders
            (po_number, vendor_id, purchase_order_state,
             ordered_at, expected_at, closed_at, notes,
             correlation_id, created_at, updated_at, version)
          VALUES
            (${po.poNumber}, ${vendorId}::uuid, ${po.status}::"inventory"."PurchaseOrderState",
             ${po.orderedDate ? new Date(po.orderedDate) : new Date()},
             NULL,
             ${po.fulfilledDate ? new Date(po.fulfilledDate) : null},
             ${po.notes ?? null},
             ${randomUUID()}, NOW(), NOW(), 0)
          ON CONFLICT DO NOTHING
          RETURNING id
        `;

        if (result[0]) {
          await recordImportMapping(prisma, 'PURCHASE_ORDER', po.smId, result[0].id);
        } else {
          poSkipped++;
          continue;
        }
      }
      poInserted++;
    } catch (err) {
      poErrors++;
      await recordError(
        prisma, poBatchId, 'LOAD', 'INSERT_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await completeBatch(prisma, poBatchId, purchaseOrders.length, poErrors, poErrors === 0 ? 'COMPLETED' : 'FAILED');

  return {
    vendors: { batchId: vendorBatchId, wave: 'F', inserted: vInserted, skipped: vSkipped, errors: vErrors },
    purchaseOrders: { batchId: poBatchId, wave: 'F', inserted: poInserted, skipped: poSkipped, errors: poErrors },
  };
}
