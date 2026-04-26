import {
  test,
  expect,
  waitForAppReady,
  appBaseUrl,
  type MockRole,
} from '../../fixtures/auth';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface KnownA11y {
  pages: Record<string, string[]>;
}
const KNOWN: KnownA11y = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', 'scripts', 'a11y-known.json'), 'utf8'),
);
function knownForPath(p: string): string[] {
  return KNOWN.pages[p] ?? [];
}

/**
 * a11y tier — runs axe-core against ~12 representative pages, one per
 * primary surface. Fails ONLY on `critical` and `serious` impact at the
 * outset; `moderate` and `minor` are reported (saved to JSON) but don't
 * gate. As remediation lands, tighten the gate.
 *
 * Per-spec JSON output: reports/a11y/<safe-test-id>.json
 */

const REPORT_DIR = resolve(import.meta.dirname, '..', '..', 'reports', 'a11y');

interface A11yPage {
  app: 'web' | 'floor-tech' | 'training';
  path: string;
  signedInAs: MockRole;
}

const PAGES: A11yPage[] = [
  // ERP — one per nav section
  { app: 'web', path: '/', signedInAs: 'admin' },
  { app: 'web', path: '/work-orders/dispatch', signedInAs: 'shop_manager' },
  { app: 'web', path: '/work-orders/open', signedInAs: 'shop_manager' },
  { app: 'web', path: '/inventory/parts', signedInAs: 'parts_manager' },
  { app: 'web', path: '/customer-dealers/customers', signedInAs: 'sales' },
  { app: 'web', path: '/sales/pipeline', signedInAs: 'sales' },
  { app: 'web', path: '/planning/slots', signedInAs: 'shop_manager' },
  { app: 'web', path: '/accounting/sync', signedInAs: 'accounting' },
  { app: 'web', path: '/training/sop', signedInAs: 'trainer_ojt_lead' },
  { app: 'web', path: '/admin/access', signedInAs: 'admin' },
  // Floor Tech
  { app: 'floor-tech', path: '/work-orders/my-queue', signedInAs: 'technician' },
  // Training
  { app: 'training', path: '/modules', signedInAs: 'technician' },
];

for (const p of PAGES) {
  test(`a11y: [${p.app}] ${p.path} (as ${p.signedInAs})`, async ({ page, signInAs }) => {
    await signInAs(p.signedInAs);
    await page.goto(appBaseUrl(p.app) + p.path);
    await waitForAppReady(page);
    // Many pages render their interactive controls (selects, buttons) only
    // after their async data load resolves. Give them a beat to stabilize
    // before axe scans, otherwise flakiness toggles known issues on/off.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Persist full report.
    mkdirSync(REPORT_DIR, { recursive: true });
    const filename = `${p.app}--${p.path.replace(/[^a-zA-Z0-9]+/g, '-')}.json`.replace(/^-+|-+$/g, '');
    writeFileSync(resolve(REPORT_DIR, filename), JSON.stringify(result, null, 2));

    // Color-contrast is excluded from the initial gate — the brand palette
    // (orange + cream) consistently fails WCAG AA and would gate every
    // page until a redesign. The full violation list is still saved to
    // the JSON report so designers can see + prioritize.
    const GLOBAL_EXCLUDED = new Set(['color-contrast']);
    // Per-page known issues (scripts/a11y-known.json) — track drift in both
    // directions: new rule appears here OR a known rule disappears.
    const pageKnown = new Set(knownForPath(p.path));

    const blocking = result.violations.filter(
      (v) =>
        (v.impact === 'critical' || v.impact === 'serious') &&
        !GLOBAL_EXCLUDED.has(v.id) &&
        !pageKnown.has(v.id),
    );
    const summary = blocking
      .slice(0, 5)
      .map((v) => `  • [${v.impact}] ${v.id}: ${v.help}`)
      .join('\n');
    expect(
      blocking,
      `${blocking.length} new critical/serious a11y violations on ${p.path}\n${summary}\n` +
        'If this is intentional/expected for now, add the rule id to apps/qa/scripts/a11y-known.json.',
    ).toEqual([]);

    // Drift in the OTHER direction: known issues that no longer occur are
    // celebrated by failing the test so the entry can be removed.
    const stillKnown = result.violations.map((v) => v.id);
    const fixed = [...pageKnown].filter((id) => !stillKnown.includes(id));
    expect(
      fixed,
      `Known a11y issues no longer present on ${p.path}: ${fixed.join(', ')}. ` +
        '✅ Remove these entries from apps/qa/scripts/a11y-known.json.',
    ).toEqual([]);
  });
}
