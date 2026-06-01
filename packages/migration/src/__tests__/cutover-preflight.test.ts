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

  it('warns but does not fail when optional entities are absent', () => {
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

    expect(report.overallStatus).toBe('WARN');
    expect(report.totals.totalRows).toBe(953);
    expect(report.gates.find((gate) => gate.key === 'parts')?.status).toBe('WARN');

    const html = renderCutoverPreflightHtml(report);
    expect(html).toContain('ShopMonkey Cutover Preflight');
    expect(html).toContain('Entity Gates');
    expect(html).not.toContain('<script');
  });
});
