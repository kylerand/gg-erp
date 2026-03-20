import type { PrismaClient } from '@prisma/client';

const SHOPMONKEY_NAMESPACE = 'shopmonkey:v1';

/** Stable ID for the ShopMonkey migration integration account (seeded once). */
export const MIGRATION_INTEGRATION_ACCOUNT_ID = '00000000-0000-0000-0000-000000000003';

export async function isAlreadyImported(
  prisma: PrismaClient,
  entityType: string,
  sourceId: string,
): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM integrations.external_id_mappings
    WHERE integration_account_id = CAST(${MIGRATION_INTEGRATION_ACCOUNT_ID} AS uuid)
      AND entity_type = ${entityType}
      AND external_id = ${sourceId}
      AND namespace = ${SHOPMONKEY_NAMESPACE}
  `;
  return Number(result[0]?.count ?? 0) > 0;
}

export async function recordImportMapping(
  prisma: PrismaClient,
  entityType: string,
  sourceId: string,
  internalId: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO integrations.external_id_mappings
      (integration_account_id, namespace, entity_type, external_id, entity_id)
    VALUES
      (CAST(${MIGRATION_INTEGRATION_ACCOUNT_ID} AS uuid), ${SHOPMONKEY_NAMESPACE}, ${entityType}, ${sourceId}, CAST(${internalId} AS uuid))
    ON CONFLICT (integration_account_id, entity_type, entity_id, namespace) DO NOTHING
  `;
}
