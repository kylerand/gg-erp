import type { PrismaClient } from '@prisma/client';

const SHOPMONKEY_NAMESPACE = 'shopmonkey:v1';

export async function isAlreadyImported(
  prisma: PrismaClient,
  entityType: string,
  sourceId: string,
): Promise<boolean> {
  // Check integrations.external_id_mappings table for existing mapping
  // Uses raw query since this table may be in a different schema
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM integrations.external_id_mappings
    WHERE namespace = ${SHOPMONKEY_NAMESPACE}
      AND entity_type = ${entityType}
      AND external_id = ${sourceId}
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
      (namespace, entity_type, external_id, internal_id, created_at)
    VALUES
      (${SHOPMONKEY_NAMESPACE}, ${entityType}, ${sourceId}, ${internalId}, NOW())
    ON CONFLICT (namespace, entity_type, external_id) DO NOTHING
  `;
}
