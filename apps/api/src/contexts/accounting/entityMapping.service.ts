/**
 * Entity mapping service — resolves GG entity IDs ↔ QuickBooks external IDs.
 *
 * Uses the `external_id_mappings` table in the integrations schema. Ensures
 * idempotent pushes: before creating a QB resource, check if a mapping already
 * exists and reuse the external ID.
 */
import { PrismaClient } from '@prisma/client';

export interface ExternalMapping {
  id: string;
  integrationAccountId: string;
  entityType: string;
  entityId: string;
  externalId: string;
  namespace: string;
  isActive: boolean;
}

export interface EntityMappingServiceDeps {
  prisma: PrismaClient;
}

export class EntityMappingService {
  constructor(private readonly deps: EntityMappingServiceDeps) {}

  /**
   * Look up the external (QB) ID for a given GG entity.
   * Returns null if no mapping exists yet.
   */
  async findExternalId(
    integrationAccountId: string,
    entityType: string,
    entityId: string,
    namespace = 'default'
  ): Promise<string | null> {
    const mapping = await this.deps.prisma.externalIdMapping.findUnique({
      where: {
        integrationAccountId_entityType_entityId_namespace: {
          integrationAccountId,
          entityType,
          entityId,
          namespace,
        },
      },
    });
    return mapping?.isActive ? mapping.externalId : null;
  }

  /**
   * Look up the GG entity ID for a given external (QB) ID.
   * Used when processing inbound webhooks from QB.
   */
  async findEntityId(
    integrationAccountId: string,
    entityType: string,
    externalId: string,
    namespace = 'default'
  ): Promise<string | null> {
    const mapping = await this.deps.prisma.externalIdMapping.findFirst({
      where: {
        integrationAccountId,
        entityType,
        externalId,
        namespace,
        isActive: true,
      },
    });
    return mapping?.entityId ?? null;
  }

  /**
   * Create or update a mapping between a GG entity and an external QB ID.
   * Upserts to avoid duplicates.
   */
  async upsertMapping(
    integrationAccountId: string,
    entityType: string,
    entityId: string,
    externalId: string,
    namespace = 'default'
  ): Promise<ExternalMapping> {
    const result = await this.deps.prisma.externalIdMapping.upsert({
      where: {
        integrationAccountId_entityType_entityId_namespace: {
          integrationAccountId,
          entityType,
          entityId,
          namespace,
        },
      },
      update: {
        externalId,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        integrationAccountId,
        entityType,
        entityId,
        externalId,
        namespace,
        isActive: true,
      },
    });

    return {
      id: result.id,
      integrationAccountId: result.integrationAccountId,
      entityType: result.entityType,
      entityId: result.entityId,
      externalId: result.externalId,
      namespace: result.namespace,
      isActive: result.isActive,
    };
  }

  /**
   * Soft-deactivate a mapping (e.g., when a QB entity is deleted).
   */
  async deactivateMapping(
    integrationAccountId: string,
    entityType: string,
    entityId: string,
    namespace = 'default'
  ): Promise<void> {
    await this.deps.prisma.externalIdMapping.updateMany({
      where: { integrationAccountId, entityType, entityId, namespace },
      data: { isActive: false, updatedAt: new Date() },
    });
  }

  /**
   * List all active mappings for a given entity type under an integration account.
   */
  async listMappings(
    integrationAccountId: string,
    entityType: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ items: ExternalMapping[]; total: number }> {
    const { limit = 100, offset = 0 } = options;
    const where = { integrationAccountId, entityType, isActive: true };

    const [items, total] = await Promise.all([
      this.deps.prisma.externalIdMapping.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.deps.prisma.externalIdMapping.count({ where }),
    ]);

    return {
      items: items.map((m) => ({
        id: m.id,
        integrationAccountId: m.integrationAccountId,
        entityType: m.entityType,
        entityId: m.entityId,
        externalId: m.externalId,
        namespace: m.namespace,
        isActive: m.isActive,
      })),
      total,
    };
  }
}
