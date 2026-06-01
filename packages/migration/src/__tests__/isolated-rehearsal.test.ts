import { describe, expect, it } from 'vitest';
import {
  assertSafeRehearsalDatabaseUrl,
  buildIsolatedRehearsalReport,
  renderIsolatedRehearsalHtml,
} from '../validation/isolated-rehearsal.js';

describe('ShopMonkey isolated rehearsal report', () => {
  it('refuses non-local or non-rehearsal database URLs', () => {
    expect(() =>
      assertSafeRehearsalDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/gg_erp_rehearsal'),
    ).not.toThrow();

    expect(() =>
      assertSafeRehearsalDatabaseUrl('postgresql://postgres:postgres@db.internal:5432/gg_erp_rehearsal'),
    ).toThrow(/localhost/);

    expect(() =>
      assertSafeRehearsalDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/gg_erp_prod'),
    ).toThrow(/rehears/);
  });

  it('fails when required row counts are not imported', () => {
    const report = buildIsolatedRehearsalReport({
      generatedAt: '2026-06-01T00:00:00.000Z',
      sourceFile: 'shopmonkey-sanitized.json',
      sourceKind: 'sanitized-report',
      database: { mode: 'disposable-docker', image: 'postgres:16-alpine', keptContainer: false },
      commands: [
        {
          name: 'Run ShopMonkey loader',
          command: 'npx tsx packages/migration/src/cli/load-shopmonkey.ts shopmonkey-sanitized.json',
          status: 'PASS',
          exitCode: 0,
          durationMs: 1200,
        },
      ],
      entities: [
        {
          key: 'customers',
          label: 'Customers',
          required: true,
          sourceRows: 10,
          sourceSkipped: 0,
          importedRows: 9,
          mappedRows: 9,
        },
      ],
    });

    expect(report.overallStatus).toBe('FAIL');
    expect(report.entities[0].status).toBe('FAIL');
  });

  it('renders counts-only HTML evidence', () => {
    const report = buildIsolatedRehearsalReport({
      generatedAt: '2026-06-01T00:00:00.000Z',
      sourceFile: 'shopmonkey-sanitized.json',
      sourceKind: 'sanitized-report',
      database: { mode: 'disposable-docker', image: 'postgres:16-alpine', keptContainer: false },
      commands: [],
      entities: [
        {
          key: 'vendors',
          label: 'Vendors',
          required: true,
          sourceRows: 2,
          sourceSkipped: 0,
          importedRows: 2,
          mappedRows: 2,
        },
      ],
      supportingCounts: { 'Migration errors': 0 },
    });

    const html = renderIsolatedRehearsalHtml(report);
    expect(report.overallStatus).toBe('PASS');
    expect(html).toContain('ShopMonkey Isolated Rehearsal');
    expect(html).toContain('Entity Reconciliation');
    expect(html).not.toContain('<script');
  });
});
