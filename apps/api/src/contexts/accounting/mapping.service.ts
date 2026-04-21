import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  DimensionMappingType,
  type FinancialDimensionMapping as PrismaFinancialDimensionMapping,
  type TaxCodeMapping as PrismaTaxCodeMapping,
} from '@prisma/client';

export { DimensionMappingType };

export interface DimensionMapping {
  id: string;
  integrationAccountId: string;
  mappingType: DimensionMappingType;
  internalCode: string;
  externalId: string;
  displayName: string | null;
  namespace: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaxMapping {
  id: string;
  integrationAccountId: string;
  taxRegionCode: string;
  internalTaxCode: string;
  externalTaxCodeId: string;
  externalRateName: string | null;
  namespace: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDimensionInput {
  integrationAccountId: string;
  mappingType: DimensionMappingType;
  internalCode: string;
  externalId: string;
  displayName?: string;
  namespace?: string;
}

export interface UpsertTaxInput {
  integrationAccountId: string;
  taxRegionCode: string;
  internalTaxCode: string;
  externalTaxCodeId: string;
  externalRateName?: string;
  namespace?: string;
}

// ─── Required dimension types for invoice export ──────────────────────────────

const REQUIRED_DIMENSION_TYPES: DimensionMappingType[] = [
  DimensionMappingType.INCOME_ACCOUNT,
  DimensionMappingType.AR_ACCOUNT,
];

// ─── Prisma singleton ─────────────────────────────────────────────────────────

let mappingPrisma: PrismaClient | undefined;

function getMappingPrisma(): PrismaClient {
  mappingPrisma ??= new PrismaClient();
  return mappingPrisma;
}

// ─── Query objects (mockable in tests) ────────────────────────────────────────

export const mappingQueries = {
  async findDimension(
    integrationAccountId: string,
    mappingType: DimensionMappingType,
    namespace: string,
  ): Promise<DimensionMapping | null> {
    const r = await getMappingPrisma().financialDimensionMapping.findFirst({
      where: { integrationAccountId, mappingType, namespace, isActive: true },
    });
    return r ? toDimensionDomain(r) : null;
  },

  async upsertDimension(input: UpsertDimensionInput): Promise<DimensionMapping> {
    const ns = input.namespace ?? 'default';
    const now = new Date();
    const r = await getMappingPrisma().financialDimensionMapping.upsert({
      where: {
        integrationAccountId_mappingType_internalCode_namespace: {
          integrationAccountId: input.integrationAccountId,
          mappingType: input.mappingType,
          internalCode: input.internalCode,
          namespace: ns,
        },
      },
      update: {
        externalId: input.externalId,
        displayName: input.displayName ?? null,
        isActive: true,
        updatedAt: now,
        version: { increment: 1 },
      },
      create: {
        id: randomUUID(),
        integrationAccountId: input.integrationAccountId,
        mappingType: input.mappingType,
        internalCode: input.internalCode,
        externalId: input.externalId,
        displayName: input.displayName ?? null,
        namespace: ns,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toDimensionDomain(r);
  },

  async listDimensions(integrationAccountId: string, namespace: string): Promise<DimensionMapping[]> {
    const rows = await getMappingPrisma().financialDimensionMapping.findMany({
      where: { integrationAccountId, namespace, isActive: true },
      orderBy: [{ mappingType: 'asc' }, { internalCode: 'asc' }],
    });
    return rows.map(toDimensionDomain);
  },

  async upsertTax(input: UpsertTaxInput): Promise<TaxMapping> {
    const ns = input.namespace ?? 'default';
    const now = new Date();
    const r = await getMappingPrisma().taxCodeMapping.upsert({
      where: {
        integrationAccountId_taxRegionCode_internalTaxCode_namespace: {
          integrationAccountId: input.integrationAccountId,
          taxRegionCode: input.taxRegionCode,
          internalTaxCode: input.internalTaxCode,
          namespace: ns,
        },
      },
      update: {
        externalTaxCodeId: input.externalTaxCodeId,
        externalRateName: input.externalRateName ?? null,
        isActive: true,
        updatedAt: now,
        version: { increment: 1 },
      },
      create: {
        id: randomUUID(),
        integrationAccountId: input.integrationAccountId,
        taxRegionCode: input.taxRegionCode,
        internalTaxCode: input.internalTaxCode,
        externalTaxCodeId: input.externalTaxCodeId,
        externalRateName: input.externalRateName ?? null,
        namespace: ns,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toTaxDomain(r);
  },

  async listTax(integrationAccountId: string, namespace: string): Promise<TaxMapping[]> {
    const rows = await getMappingPrisma().taxCodeMapping.findMany({
      where: { integrationAccountId, namespace, isActive: true },
      orderBy: [{ taxRegionCode: 'asc' }, { internalTaxCode: 'asc' }],
    });
    return rows.map(toTaxDomain);
  },
};

export type MappingQueries = typeof mappingQueries;

// ─── Domain mappers ───────────────────────────────────────────────────────────

function toDimensionDomain(r: PrismaFinancialDimensionMapping): DimensionMapping {
  return {
    id: r.id,
    integrationAccountId: r.integrationAccountId,
    mappingType: r.mappingType,
    internalCode: r.internalCode,
    externalId: r.externalId,
    displayName: r.displayName,
    namespace: r.namespace,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toTaxDomain(r: PrismaTaxCodeMapping): TaxMapping {
  return {
    id: r.id,
    integrationAccountId: r.integrationAccountId,
    taxRegionCode: r.taxRegionCode,
    internalTaxCode: r.internalTaxCode,
    externalTaxCodeId: r.externalTaxCodeId,
    externalRateName: r.externalRateName,
    namespace: r.namespace,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface MappingServiceDeps {
  queries: MappingQueries;
}

export class MappingService {
  constructor(private readonly deps: MappingServiceDeps) {}

  /**
   * Preflight check before an invoice is pushed to QB.
   * Returns null when all required mappings are present, or an error string
   * describing the first missing mapping (non-retryable until config changes).
   */
  async validateInvoiceMappings(
    integrationAccountId: string,
    namespace = 'default',
  ): Promise<string | null> {
    for (const type of REQUIRED_DIMENSION_TYPES) {
      const mapping = await this.deps.queries.findDimension(integrationAccountId, type, namespace);
      if (!mapping) {
        return `MAPPING_MISSING: no active ${type} dimension mapping for account ${integrationAccountId}`;
      }
    }
    return null;
  }

  async upsertDimensionMapping(input: UpsertDimensionInput): Promise<DimensionMapping> {
    return this.deps.queries.upsertDimension(input);
  }

  async listDimensionMappings(
    integrationAccountId: string,
    namespace = 'default',
  ): Promise<DimensionMapping[]> {
    return this.deps.queries.listDimensions(integrationAccountId, namespace);
  }

  async upsertTaxMapping(input: UpsertTaxInput): Promise<TaxMapping> {
    return this.deps.queries.upsertTax(input);
  }

  async listTaxMappings(
    integrationAccountId: string,
    namespace = 'default',
  ): Promise<TaxMapping[]> {
    return this.deps.queries.listTax(integrationAccountId, namespace);
  }
}
