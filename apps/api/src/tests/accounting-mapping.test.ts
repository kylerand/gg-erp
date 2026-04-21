import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MappingService,
  DimensionMappingType,
  type MappingQueries,
  type DimensionMapping,
  type TaxMapping,
} from '../contexts/accounting/mapping.service.js';

// ─── In-memory store helpers ──────────────────────────────────────────────────

function makeDimension(overrides: Partial<DimensionMapping> = {}): DimensionMapping {
  return {
    id: 'dim-1',
    integrationAccountId: 'acct-1',
    mappingType: DimensionMappingType.INCOME_ACCOUNT,
    internalCode: 'INCOME_DEFAULT',
    externalId: 'qb-income-1',
    displayName: null,
    namespace: 'default',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTax(overrides: Partial<TaxMapping> = {}): TaxMapping {
  return {
    id: 'tax-1',
    integrationAccountId: 'acct-1',
    taxRegionCode: 'US-CA',
    internalTaxCode: 'TAX_CA_STD',
    externalTaxCodeId: 'qb-tax-ca-1',
    externalRateName: null,
    namespace: 'default',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeQueries(
  dims: DimensionMapping[] = [],
  taxes: TaxMapping[] = [],
): MappingQueries {
  const dimStore = [...dims];
  const taxStore = [...taxes];

  return {
    async findDimension(accountId, type, namespace) {
      return (
        dimStore.find(
          (d) =>
            d.integrationAccountId === accountId &&
            d.mappingType === type &&
            d.namespace === namespace &&
            d.isActive,
        ) ?? null
      );
    },
    async upsertDimension(input) {
      const ns = input.namespace ?? 'default';
      const existing = dimStore.findIndex(
        (d) =>
          d.integrationAccountId === input.integrationAccountId &&
          d.mappingType === input.mappingType &&
          d.internalCode === input.internalCode &&
          d.namespace === ns,
      );
      const record = makeDimension({
        integrationAccountId: input.integrationAccountId,
        mappingType: input.mappingType,
        internalCode: input.internalCode,
        externalId: input.externalId,
        displayName: input.displayName ?? null,
        namespace: ns,
      });
      if (existing >= 0) {
        dimStore[existing] = record;
      } else {
        dimStore.push(record);
      }
      return record;
    },
    async listDimensions(accountId, namespace) {
      return dimStore.filter(
        (d) => d.integrationAccountId === accountId && d.namespace === namespace && d.isActive,
      );
    },
    async upsertTax(input) {
      const ns = input.namespace ?? 'default';
      const existing = taxStore.findIndex(
        (t) =>
          t.integrationAccountId === input.integrationAccountId &&
          t.taxRegionCode === input.taxRegionCode &&
          t.internalTaxCode === input.internalTaxCode &&
          t.namespace === ns,
      );
      const record = makeTax({
        integrationAccountId: input.integrationAccountId,
        taxRegionCode: input.taxRegionCode,
        internalTaxCode: input.internalTaxCode,
        externalTaxCodeId: input.externalTaxCodeId,
        externalRateName: input.externalRateName ?? null,
        namespace: ns,
      });
      if (existing >= 0) {
        taxStore[existing] = record;
      } else {
        taxStore.push(record);
      }
      return record;
    },
    async listTax(accountId, namespace) {
      return taxStore.filter(
        (t) => t.integrationAccountId === accountId && t.namespace === namespace && t.isActive,
      );
    },
  };
}

// ─── validateInvoiceMappings ──────────────────────────────────────────────────

describe('MappingService.validateInvoiceMappings', () => {
  test('returns null when all required dimension mappings are present', async () => {
    const dims = [
      makeDimension({ mappingType: DimensionMappingType.INCOME_ACCOUNT }),
      makeDimension({ mappingType: DimensionMappingType.AR_ACCOUNT, id: 'dim-2', internalCode: 'AR_DEFAULT' }),
    ];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.validateInvoiceMappings('acct-1');
    assert.equal(result, null);
  });

  test('returns error string when INCOME_ACCOUNT mapping is missing', async () => {
    const dims = [
      makeDimension({ mappingType: DimensionMappingType.AR_ACCOUNT, internalCode: 'AR_DEFAULT' }),
    ];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.validateInvoiceMappings('acct-1');
    assert.match(result!, /MAPPING_MISSING/);
    assert.match(result!, /INCOME_ACCOUNT/);
  });

  test('returns error string when AR_ACCOUNT mapping is missing', async () => {
    const dims = [
      makeDimension({ mappingType: DimensionMappingType.INCOME_ACCOUNT }),
    ];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.validateInvoiceMappings('acct-1');
    assert.match(result!, /MAPPING_MISSING/);
    assert.match(result!, /AR_ACCOUNT/);
  });

  test('returns error when no mappings exist at all', async () => {
    const service = new MappingService({ queries: makeQueries() });
    const result = await service.validateInvoiceMappings('acct-1');
    assert.match(result!, /MAPPING_MISSING/);
  });

  test('inactive mapping counts as missing', async () => {
    const dims = [
      makeDimension({ mappingType: DimensionMappingType.INCOME_ACCOUNT, isActive: false }),
      makeDimension({ mappingType: DimensionMappingType.AR_ACCOUNT, id: 'dim-2', internalCode: 'AR_DEFAULT' }),
    ];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.validateInvoiceMappings('acct-1');
    assert.match(result!, /INCOME_ACCOUNT/);
  });
});

// ─── upsertDimensionMapping ───────────────────────────────────────────────────

describe('MappingService.upsertDimensionMapping', () => {
  test('creates a new dimension mapping', async () => {
    const service = new MappingService({ queries: makeQueries() });
    const result = await service.upsertDimensionMapping({
      integrationAccountId: 'acct-1',
      mappingType: DimensionMappingType.INCOME_ACCOUNT,
      internalCode: 'INCOME_DEFAULT',
      externalId: 'qb-income-99',
    });
    assert.equal(result.externalId, 'qb-income-99');
    assert.equal(result.mappingType, DimensionMappingType.INCOME_ACCOUNT);
  });

  test('upsert is idempotent — second call with same key returns updated record', async () => {
    const service = new MappingService({ queries: makeQueries() });
    await service.upsertDimensionMapping({
      integrationAccountId: 'acct-1',
      mappingType: DimensionMappingType.ITEM,
      internalCode: 'PART-OIL',
      externalId: 'qb-item-1',
    });
    const second = await service.upsertDimensionMapping({
      integrationAccountId: 'acct-1',
      mappingType: DimensionMappingType.ITEM,
      internalCode: 'PART-OIL',
      externalId: 'qb-item-2',
    });
    assert.equal(second.externalId, 'qb-item-2');
  });
});

// ─── listDimensionMappings ────────────────────────────────────────────────────

describe('MappingService.listDimensionMappings', () => {
  test('returns all active dimension mappings for account', async () => {
    const dims = [
      makeDimension({ mappingType: DimensionMappingType.INCOME_ACCOUNT }),
      makeDimension({ mappingType: DimensionMappingType.AR_ACCOUNT, id: 'dim-2', internalCode: 'AR' }),
    ];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.listDimensionMappings('acct-1');
    assert.equal(result.length, 2);
  });

  test('does not return mappings for a different account', async () => {
    const dims = [makeDimension({ integrationAccountId: 'acct-other' })];
    const service = new MappingService({ queries: makeQueries(dims) });
    const result = await service.listDimensionMappings('acct-1');
    assert.equal(result.length, 0);
  });
});

// ─── upsertTaxMapping ─────────────────────────────────────────────────────────

describe('MappingService.upsertTaxMapping', () => {
  test('creates a new tax mapping', async () => {
    const service = new MappingService({ queries: makeQueries() });
    const result = await service.upsertTaxMapping({
      integrationAccountId: 'acct-1',
      taxRegionCode: 'US-TX',
      internalTaxCode: 'TAX_TX_STD',
      externalTaxCodeId: 'qb-tax-tx-1',
      externalRateName: 'Texas Sales Tax',
    });
    assert.equal(result.externalTaxCodeId, 'qb-tax-tx-1');
    assert.equal(result.externalRateName, 'Texas Sales Tax');
  });

  test('upsert is idempotent — updates externalTaxCodeId on second call', async () => {
    const service = new MappingService({ queries: makeQueries() });
    await service.upsertTaxMapping({
      integrationAccountId: 'acct-1',
      taxRegionCode: 'US-CA',
      internalTaxCode: 'TAX_CA_STD',
      externalTaxCodeId: 'qb-tax-old',
    });
    const second = await service.upsertTaxMapping({
      integrationAccountId: 'acct-1',
      taxRegionCode: 'US-CA',
      internalTaxCode: 'TAX_CA_STD',
      externalTaxCodeId: 'qb-tax-new',
    });
    assert.equal(second.externalTaxCodeId, 'qb-tax-new');
  });
});

// ─── listTaxMappings ──────────────────────────────────────────────────────────

describe('MappingService.listTaxMappings', () => {
  test('returns all active tax mappings for account', async () => {
    const taxes = [
      makeTax({ taxRegionCode: 'US-CA' }),
      makeTax({ id: 'tax-2', taxRegionCode: 'US-TX', internalTaxCode: 'TAX_TX_STD', externalTaxCodeId: 'qb-tx' }),
    ];
    const service = new MappingService({ queries: makeQueries([], taxes) });
    const result = await service.listTaxMappings('acct-1');
    assert.equal(result.length, 2);
  });

  test('does not return mappings for a different account', async () => {
    const taxes = [makeTax({ integrationAccountId: 'acct-other' })];
    const service = new MappingService({ queries: makeQueries([], taxes) });
    const result = await service.listTaxMappings('acct-1');
    assert.equal(result.length, 0);
  });
});
