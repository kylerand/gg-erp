import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { SanitizedPart } from '../sanitize/sanitize-export.js';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

/**
 * Wave C — Inventory Parts.
 *
 * Loads SmInventoryPart records from the ShopMonkey JSON export into
 * inventory.parts. Optionally links to the internal vendor ID (requires
 * Wave F to have run first; skips vendor link if mapping is absent).
 *
 * sourceFile: path to shopmonkey-export-<ts>.json
 */
export async function runWaveC(
  prisma: PrismaClient,
  sourceFile: string,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'C', sourceFile);

  const raw = await readFile(sourceFile, 'utf8');
  const exportData: ShopMonkeyExport = JSON.parse(raw);
  const report = sanitizeExport(exportData, sourceFile);
  const parts: SanitizedPart[] = report.parts;

  let inserted = 0;
  let skipped = 0;
  let errorCount = 0;

  for (const part of parts) {
    try {
      if (part.skip) {
        skipped++;
        continue;
      }

      if (await isAlreadyImported(prisma, 'INVENTORY_PART', part.smId)) {
        skipped++;
        continue;
      }

      await recordRawRecord(prisma, batchId, 'INVENTORY_PART', part.smId, part);

      if (!dryRun) {
        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO inventory.parts
            (sku, name, unit_of_measure, part_state, reorder_point, created_at, updated_at, version)
          VALUES
            (${part.sku}, ${part.name}, 'EA', 'ACTIVE', 0, NOW(), NOW(), 0)
          RETURNING id
        `;

        const partId = result[0].id;
        await recordImportMapping(prisma, 'INVENTORY_PART', part.smId, partId);
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

  await completeBatch(prisma, batchId, parts.length, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'C', inserted, skipped, errors: errorCount };
}
