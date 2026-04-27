import {
  test,
  expect,
  waitForAppReady,
  appBaseUrl,
  type MockRole,
} from '../../fixtures/auth';

/**
 * Visual regression baselines. The first run creates `*-snapshots/*.png`
 * files alongside this spec; subsequent runs diff against them and fail if
 * the pixel diff exceeds the configured threshold.
 *
 * Update baselines (after intentional UI changes) with:
 *   npm run qa:visual:update
 *
 * Scope is intentionally small (~12 pages, one per major surface). Adding
 * everything would mean hundreds of baselines that flap on every brand
 * update.
 *
 * Per-page tweaks:
 *  - `maxDiffPixelRatio: 0.02` allows ~2% drift (font hinting, browser
 *    sub-pixel rendering, mock-data ordering jitter). Override per-spec
 *    if a page is unusually data-driven.
 *  - `mask` hides timestamps / dynamic content (replay queue counter,
 *    "today" date) so they don't flap the diff.
 */

interface VisualPage {
  app: 'web' | 'floor-tech' | 'training';
  path: string;
  signedInAs: MockRole;
  /** Css selectors to mask (replaced with a solid color in the diff). */
  maskSelectors?: string[];
  /** Override the default 2% threshold. */
  maxDiffPixelRatio?: number;
  /** Custom snapshot file basename (default = path-derived). */
  name?: string;
}

const PAGES: VisualPage[] = [
  // ERP — one per major surface
  { app: 'web', path: '/', signedInAs: 'admin', name: 'web-home' },
  { app: 'web', path: '/work-orders/dispatch', signedInAs: 'shop_manager', name: 'web-dispatch' },
  { app: 'web', path: '/work-orders/open', signedInAs: 'shop_manager', name: 'web-open-blocked' },
  { app: 'web', path: '/inventory/parts', signedInAs: 'parts_manager', name: 'web-parts' },
  { app: 'web', path: '/customer-dealers/customers', signedInAs: 'sales', name: 'web-customers' },
  { app: 'web', path: '/sales/pipeline', signedInAs: 'sales', name: 'web-pipeline' },
  { app: 'web', path: '/planning/slots', signedInAs: 'shop_manager', name: 'web-build-slots',
    maskSelectors: ['text=/Week of/i'] },
  { app: 'web', path: '/accounting/sync', signedInAs: 'accounting', name: 'web-accounting-sync' },
  { app: 'web', path: '/training/sop', signedInAs: 'trainer_ojt_lead', name: 'web-sop-library' },
  { app: 'web', path: '/admin/access', signedInAs: 'admin', name: 'web-admin-access',
    // User Created column has dynamic dates that shift baselines.
    maskSelectors: ['td:has-text("/")'] },
  // Floor Tech
  { app: 'floor-tech', path: '/work-orders/my-queue', signedInAs: 'technician', name: 'floor-tech-queue' },
  // Training
  { app: 'training', path: '/modules', signedInAs: 'technician', name: 'training-modules' },
];

for (const p of PAGES) {
  test(`visual: ${p.name ?? p.path}`, async ({ page, signInAs }) => {
    await signInAs(p.signedInAs);
    await page.goto(appBaseUrl(p.app) + p.path);
    await waitForAppReady(page);
    // Wait for animations + data to settle.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const masks = (p.maskSelectors ?? []).map((s) => page.locator(s));
    await expect(page).toHaveScreenshot(`${p.name ?? p.path.replace(/\//g, '_')}.png`, {
      fullPage: true,
      maxDiffPixelRatio: p.maxDiffPixelRatio ?? 0.02,
      mask: masks,
      animations: 'disabled',
      // Hide the floating Copilot/replay counter — they animate per render.
      stylePath: undefined,
    });
  });
}
