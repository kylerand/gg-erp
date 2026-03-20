import type { PrismaClient } from '@prisma/client';
import { isAlreadyImported, recordImportMapping, MIGRATION_INTEGRATION_ACCOUNT_ID } from './idempotency.js';
import { createBatch, completeBatch, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

/** Stable key used as the "source ID" for the single shop location. */
export const GG_LOCATION_SOURCE_ID = 'GG-MAIN';

/** Placeholder UUID for the "migration system" user actor. */
export const MIGRATION_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Wave A — Seed: Location, Integration Account, System User.
 *
 * 1. Creates the single Golfin Garage shop location in inventory.stock_locations.
 * 2. Creates the ShopMonkey integration account in integrations.integration_accounts.
 * 3. Creates the migration system user in identity.users (used as the actor for imported records).
 *
 * No source file is parsed — this is a pure seed wave.
 * Idempotent: safe to re-run; skips rows that already exist.
 */
export async function runWaveA(
  prisma: PrismaClient,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'A', GG_LOCATION_SOURCE_ID);
  let inserted = 0;
  let skipped = 0;
  let errorCount = 0;

  // ── 1. Stock Location ────────────────────────────────────────────────────
  try {
    if (await isAlreadyImported(prisma, 'LOCATION', GG_LOCATION_SOURCE_ID)) {
      skipped++;
    } else if (!dryRun) {
      const result = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO inventory.stock_locations
          (location_code, location_name, location_type, is_pickable, timezone_name, created_at, updated_at, version)
        VALUES
          ('GG-MAIN', 'Golfin Garage', 'WAREHOUSE', true, 'America/Chicago', NOW(), NOW(), 0)
        ON CONFLICT DO NOTHING
        RETURNING id
      `;

      if (result[0]) {
        await recordImportMapping(prisma, 'LOCATION', GG_LOCATION_SOURCE_ID, result[0].id);
        inserted++;
      } else {
        const existing = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM inventory.stock_locations WHERE location_code = 'GG-MAIN' LIMIT 1
        `;
        if (existing[0]) {
          await recordImportMapping(prisma, 'LOCATION', GG_LOCATION_SOURCE_ID, existing[0].id);
        }
        skipped++;
      }
    } else {
      inserted++;
    }
  } catch (err) {
    errorCount++;
    await recordError(prisma, batchId, 'LOAD', 'SEED_LOCATION_FAILED', err instanceof Error ? err.message : String(err));
  }

  // ── 2. Integration Account ───────────────────────────────────────────────
  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM integrations.integration_accounts
      WHERE id = CAST(${MIGRATION_INTEGRATION_ACCOUNT_ID} AS uuid)
      LIMIT 1
    `;
    if (existing[0]) {
      skipped++;
    } else if (!dryRun) {
      await prisma.$executeRaw`
        INSERT INTO integrations.integration_accounts
          (id, provider, account_key, display_name, account_status, configuration, created_at, updated_at, version)
        VALUES
          (CAST(${MIGRATION_INTEGRATION_ACCOUNT_ID} AS uuid),
           'SHOPMONKEY', 'shopmonkey-migration', 'ShopMonkey Migration',
           'ACTIVE', '{}', NOW(), NOW(), 0)
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    } else {
      inserted++;
    }
  } catch (err) {
    errorCount++;
    await recordError(prisma, batchId, 'LOAD', 'SEED_INTEGRATION_FAILED', err instanceof Error ? err.message : String(err));
  }

  // ── 3. Migration System User ─────────────────────────────────────────────
  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.users
      WHERE id = CAST(${MIGRATION_SYSTEM_USER_ID} AS uuid)
      LIMIT 1
    `;
    if (existing[0]) {
      skipped++;
    } else if (!dryRun) {
      await prisma.$executeRaw`
        INSERT INTO identity.users
          (id, cognito_subject, email, display_name, status, created_at, updated_at, version)
        VALUES
          (CAST(${MIGRATION_SYSTEM_USER_ID} AS uuid),
           'imported:migration-system', 'migration@system.local', 'Migration System',
           'ACTIVE', NOW(), NOW(), 0)
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    } else {
      inserted++;
    }
  } catch (err) {
    errorCount++;
    await recordError(prisma, batchId, 'LOAD', 'SEED_SYSTEM_USER_FAILED', err instanceof Error ? err.message : String(err));
  }

  await completeBatch(prisma, batchId, 3, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'A', inserted, skipped, errors: errorCount };
}
