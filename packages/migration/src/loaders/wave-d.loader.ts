import type { PrismaClient } from '@prisma/client';
import { parseCustomersCsv, parseAssetsCsv } from '../parsers/index.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

export async function runWaveD(
  prisma: PrismaClient,
  customersCsvPath: string,
  assetsCsvPath: string,
  dryRun = false,
): Promise<{ customers: LoadResult; assets: LoadResult }> {
  // Customers
  const custBatchId = await createBatch(prisma, 'D', customersCsvPath);
  const { records: customers, errors: custParseErrors } = await parseCustomersCsv(customersCsvPath);
  let custInserted = 0, custSkipped = 0, custErrors = custParseErrors.length;

  for (const parseError of custParseErrors) {
    await recordError(prisma, custBatchId, 'PARSE', 'PARSE_ERROR', parseError.message);
  }

  for (const cust of customers) {
    try {
      if (await isAlreadyImported(prisma, 'CUSTOMER', cust.id)) { custSkipped++; continue; }
      await recordRawRecord(prisma, custBatchId, 'CUSTOMER', cust.id, cust);

      if (!dryRun) {
        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO customers.customers
            (first_name, last_name, email, phone, created_at, updated_at)
          VALUES (${cust.firstName}, ${cust.lastName}, ${cust.email}, ${cust.phone ?? null}, NOW(), NOW())
          ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
          RETURNING id
        `;
        await recordImportMapping(prisma, 'CUSTOMER', cust.id, result[0].id);
      }
      custInserted++;
    } catch (err) {
      custErrors++;
      await recordError(prisma, custBatchId, 'LOAD', 'INSERT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  await completeBatch(prisma, custBatchId, customers.length, custErrors, custErrors === 0 ? 'COMPLETED' : 'FAILED');

  // Assets
  const assetBatchId = await createBatch(prisma, 'D', assetsCsvPath);
  const { records: assets, errors: assetParseErrors } = await parseAssetsCsv(assetsCsvPath);
  let assetInserted = 0, assetSkipped = 0, assetErrors = assetParseErrors.length;

  for (const parseError of assetParseErrors) {
    await recordError(prisma, assetBatchId, 'PARSE', 'PARSE_ERROR', parseError.message);
  }

  for (const asset of assets) {
    try {
      if (await isAlreadyImported(prisma, 'ASSET', asset.id)) { assetSkipped++; continue; }
      await recordRawRecord(prisma, assetBatchId, 'ASSET', asset.id, asset);

      if (!dryRun) {
        const custInternalId = await prisma.$queryRaw<Array<{ internal_id: string }>>`
          SELECT internal_id FROM integrations.external_id_mappings
          WHERE namespace = 'shopmonkey:v1' AND entity_type = 'CUSTOMER' AND external_id = ${asset.customerId}
        `;
        if (!custInternalId[0]) {
          await recordError(prisma, assetBatchId, 'LOAD', 'MISSING_FK', `Customer ${asset.customerId} not found`);
          assetErrors++;
          continue;
        }

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO customers.assets
            (customer_id, vin, year, make, model, color, license_plate, created_at, updated_at)
          VALUES (${custInternalId[0].internal_id}, ${asset.vin ?? null}, ${asset.year ? parseInt(asset.year) : null},
                  ${asset.make ?? null}, ${asset.model ?? null}, ${asset.color ?? null},
                  ${asset.licensePlate ?? null}, NOW(), NOW())
          RETURNING id
        `;
        await recordImportMapping(prisma, 'ASSET', asset.id, result[0].id);
      }
      assetInserted++;
    } catch (err) {
      assetErrors++;
      await recordError(prisma, assetBatchId, 'LOAD', 'INSERT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  await completeBatch(prisma, assetBatchId, assets.length, assetErrors, assetErrors === 0 ? 'COMPLETED' : 'FAILED');

  return {
    customers: { batchId: custBatchId, wave: 'D', inserted: custInserted, skipped: custSkipped, errors: custErrors },
    assets: { batchId: assetBatchId, wave: 'D', inserted: assetInserted, skipped: assetSkipped, errors: assetErrors },
  };
}
