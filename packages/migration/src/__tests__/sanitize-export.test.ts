import { describe, expect, it } from 'vitest';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';

function baseExport(overrides: Partial<ShopMonkeyExport> = {}): ShopMonkeyExport {
  return {
    exportedAt: '2026-06-02T00:00:00.000Z',
    companyId: 'company-1',
    customers: [],
    vehicles: [],
    orders: [],
    inventoryParts: [],
    lineItemAssignments: [],
    parts: [],
    users: [],
    vendors: [],
    purchaseOrders: [],
    timesheets: [],
    counts: {},
    ...overrides,
  };
}

describe('ShopMonkey export sanitization', () => {
  it('maps draft purchase orders without cutover warnings', () => {
    const report = sanitizeExport(
      baseExport({
        purchaseOrders: [
          {
            id: 'po-1',
            number: '27',
            status: 'Draft',
            orderedDate: '2026-06-01T00:00:00.000Z',
          },
        ],
      }),
      'shopmonkey-export.json',
    );

    expect(report.purchaseOrders[0]).toMatchObject({
      smId: 'po-1',
      poNumber: '27',
      status: 'DRAFT',
      validationWarnings: [],
      skip: false,
    });
    expect(report.counts.purchaseOrders).toEqual({
      total: 1,
      valid: 1,
      warned: 0,
      skipped: 0,
    });
  });

  it('preserves ShopMonkey source coverage metadata', () => {
    const report = sanitizeExport(
      baseExport({
        sourceCoverage: {
          inventoryParts: {
            entityKey: 'parts',
            label: 'Parts',
            source: 'GET /v3/inventory_part?take=&skip=',
            collected: 189,
            reportedTotal: 237,
            missingFromReportedTotal: 48,
            status: 'WARN',
            detail: 'ShopMonkey reported 237 inventory parts, but the API sweep exposed 189 unique rows.',
          },
        },
      }),
      'shopmonkey-export.json',
    );

    expect(report.sourceCoverage?.inventoryParts).toMatchObject({
      entityKey: 'parts',
      collected: 189,
      reportedTotal: 237,
      missingFromReportedTotal: 48,
      status: 'WARN',
    });
  });
});
