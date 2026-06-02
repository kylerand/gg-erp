import { describe, expect, it } from 'vitest';
import {
  buildCutoverPreflightReport,
  renderCutoverPreflightHtml,
} from '../validation/cutover-preflight.js';

describe('ShopMonkey cutover preflight', () => {
  it('fails when a required entity group is missing', () => {
    const report = buildCutoverPreflightReport(
      {
        counts: {
          customers: { total: 447, valid: 446, warned: 1, skipped: 0 },
          vehicles: { total: 56, valid: 56, warned: 0, skipped: 0 },
          orders: { total: 397, valid: 397, warned: 0, skipped: 0 },
          users: { total: 28, valid: 28, warned: 0, skipped: 0 },
        },
      },
      { sourceFile: 'sample.json', generatedAt: '2026-06-01T00:00:00.000Z' },
    );

    expect(report.overallStatus).toBe('FAIL');
    expect(report.gates.find((gate) => gate.key === 'vendors')?.status).toBe('FAIL');
  });

  it('fails when production-critical parts and purchase orders are absent', () => {
    const report = buildCutoverPreflightReport(
      {
        counts: {
          customers: { total: 447, valid: 446, warned: 1, skipped: 0 },
          vehicles: { total: 56, valid: 56, warned: 0, skipped: 0 },
          orders: { total: 397, valid: 397, warned: 0, skipped: 0 },
          users: { total: 28, valid: 28, warned: 0, skipped: 0 },
          vendors: { total: 25, valid: 25, warned: 0, skipped: 0 },
        },
      },
      { sourceFile: 'sample.json', generatedAt: '2026-06-01T00:00:00.000Z' },
    );

    expect(report.overallStatus).toBe('FAIL');
    expect(report.totals.totalRows).toBe(953);
    expect(report.gates.find((gate) => gate.key === 'parts')?.status).toBe('FAIL');
    expect(report.gates.find((gate) => gate.key === 'purchaseOrders')?.status).toBe('FAIL');
    expect(report.nextActions).toContain(
      'Capture ShopMonkey source rows for Parts, Purchase Orders before any shared staging or production cutover.',
    );

    const html = renderCutoverPreflightHtml(report);
    expect(html).toContain('ShopMonkey Cutover Preflight');
    expect(html).toContain('Entity Gates');
    expect(html).not.toContain('<script');
  });

  it('recognizes raw export inventoryParts counts as the parts gate', () => {
    const report = buildCutoverPreflightReport(
      {
        counts: {
          customers: 447,
          vehicles: 56,
          orders: 397,
          users: 28,
          vendors: 25,
          inventoryParts: 12,
          purchaseOrders: 4,
        },
        parts: [],
        inventoryParts: [{ id: 'part-1' }],
      },
      { sourceFile: 'raw-export.json', generatedAt: '2026-06-01T00:00:00.000Z' },
    );

    expect(report.overallStatus).toBe('WARN');
    expect(report.gates.find((gate) => gate.key === 'parts')?.total).toBe(12);
    expect(report.gates.find((gate) => gate.key === 'parts')?.status).toBe('PASS');
    expect(report.gates.find((gate) => gate.key === 'purchaseOrders')?.status).toBe('PASS');
    expect(report.gates.find((gate) => gate.key === 'lineItemAssignments')?.status).toBe('WARN');
  });

  it('builds a hashed warning review without exposing raw source IDs', () => {
    const report = buildCutoverPreflightReport(
      {
        customers: [
          {
            smId: 'raw-customer-id-1',
            fullName: 'Unknown Customer',
            validationWarnings: ['No name or company — will be imported as "Unknown Customer"'],
          },
        ],
        orders: [
          {
            smId: 'raw-work-order-id-1',
            customerId: '',
            validationWarnings: ['No customerId'],
          },
          {
            smId: 'raw-work-order-id-2',
            customerId: '',
            validationWarnings: ['No customerId'],
          },
        ],
        counts: {
          customers: { total: 447, valid: 446, warned: 1, skipped: 0 },
          vehicles: { total: 56, valid: 56, warned: 0, skipped: 0 },
          orders: { total: 465, valid: 397, warned: 68, skipped: 0 },
          users: { total: 28, valid: 28, warned: 0, skipped: 0 },
          vendors: { total: 25, valid: 25, warned: 0, skipped: 0 },
          parts: { total: 189, valid: 189, warned: 0, skipped: 0 },
          purchaseOrders: { total: 11, valid: 11, warned: 0, skipped: 0 },
        },
      },
      { sourceFile: 'sample.json', generatedAt: '2026-06-01T00:00:00.000Z' },
    );

    expect(report.warningReview.totalRowsWithWarnings).toBe(3);
    expect(report.warningReview.totalWarningReasons).toBe(3);
    expect(report.warningReview.items.find((item) => item.warning === 'No customerId')?.count).toBe(2);
    expect(report.warningReview.items.flatMap((item) => item.sampleRowKeys)).not.toContain('raw-work-order-id-1');
    expect(report.nextActions).toContain(
      'Review 3 warned source rows in the Warning Review section and sign off or repair each warning reason before staging cutover.',
    );

    const html = renderCutoverPreflightHtml(report);
    expect(html).toContain('Warning Review');
    expect(html).toContain('No customerId');
    expect(html).not.toContain('raw-customer-id-1');
    expect(html).not.toContain('raw-work-order-id-1');
  });

  it('renders ShopMonkey source coverage gaps as cutover actions', () => {
    const report = buildCutoverPreflightReport(
      {
        counts: {
          customers: { total: 447, valid: 447, warned: 0, skipped: 0 },
          vehicles: { total: 56, valid: 56, warned: 0, skipped: 0 },
          orders: { total: 465, valid: 465, warned: 0, skipped: 0 },
          users: { total: 28, valid: 28, warned: 0, skipped: 0 },
          vendors: { total: 25, valid: 25, warned: 0, skipped: 0 },
          parts: { total: 189, valid: 189, warned: 0, skipped: 0 },
          purchaseOrders: { total: 11, valid: 11, warned: 0, skipped: 0 },
        },
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
      },
      { sourceFile: 'sample.json', generatedAt: '2026-06-01T00:00:00.000Z' },
    );

    expect(report.overallStatus).toBe('WARN');
    expect(report.sourceCoverage.items[0]).toMatchObject({
      entityKey: 'parts',
      collected: 189,
      reportedTotal: 237,
      missingFromReportedTotal: 48,
      status: 'WARN',
    });
    expect(report.nextActions).toContain(
      'Review source coverage gaps: Parts missing 48 of 237 reported rows.',
    );

    const html = renderCutoverPreflightHtml(report);
    expect(html).toContain('Source Coverage');
    expect(html).toContain('GET /v3/inventory_part?take=&amp;skip=');
    expect(html).toContain('48');
  });
});
