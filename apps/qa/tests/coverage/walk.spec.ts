import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, waitForAppReady, type MockRole } from '../../fixtures/auth';

/**
 * Coverage tier: walk every page.tsx route in all three apps. For each:
 *   1. Sign in as the role most likely to use it.
 *   2. Navigate (substituting synthetic IDs for {param} segments).
 *   3. Wait for the app shell to settle.
 *   4. Assert at least one heading rendered (proxy for "the page rendered").
 *   5. Network spy (attached automatically via fixture) records every
 *      request/response with schema validation. Violations are written to
 *      reports/network/*.ndjson and aggregated by apply-network-spy.ts.
 *
 * The role mapping below is intentionally simple: 'admin' for web (sees
 * everything), 'technician' for floor-tech and training (their primary
 * users). Phase 3's role-matrix tier will exercise per-role visibility.
 *
 * To regenerate the route inventory:
 *   npm run qa:discover-web
 */

const ROUTES_FILE = resolve(import.meta.dirname, '..', '..', 'scripts', 'routes-web.json');

interface DiscoveredRoute {
  app: 'web' | 'floor-tech' | 'training';
  route: string;
  params: string[];
  file: string;
}

const PROBE_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Some routes are inherently transient or can't be visited cold (e.g. the
 * OAuth callback only makes sense with a `?code=` query param mid-OAuth).
 * Skipping these here keeps the coverage signal focused on real surfaces.
 */
const SKIP_ROUTES = new Set([
  '/auth/callback',
  '/login', // training sign-in placeholder
]);

/** Substitute {paramName} placeholders with safe probe values. */
function fillParams(route: string): string {
  return route.replace(/\{([^}]+)\}/g, (_, name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('id')) return PROBE_UUID;
    return 'qa-walk-probe';
  });
}

const APP_BASE: Record<DiscoveredRoute['app'], string> = {
  web: process.env.QA_WEB_URL ?? 'http://localhost:3010',
  'floor-tech': process.env.QA_FLOOR_TECH_URL ?? 'http://localhost:3012',
  training: process.env.QA_TRAINING_URL ?? 'http://localhost:3013',
};

const APP_ROLE: Record<DiscoveredRoute['app'], MockRole> = {
  web: 'admin',
  'floor-tech': 'technician',
  training: 'technician',
};

const routes: DiscoveredRoute[] = (() => {
  if (!existsSync(ROUTES_FILE)) {
    throw new Error(
      `Missing ${ROUTES_FILE}. Run \`npm run qa:discover-web\` first.`,
    );
  }
  return JSON.parse(readFileSync(ROUTES_FILE, 'utf8'));
})();

test.describe.configure({ mode: 'parallel' });

for (const route of routes) {
  if (SKIP_ROUTES.has(route.route)) continue;

  // Routes with dynamic params (e.g. /inventory/parts/{id}) need real seeded
  // data + real Cognito auth — server components await API calls that hang
  // without a backing record. Phase 3's role-matrix tier owns these. For
  // now, exercise them via the smoke API tier instead.
  if (route.params.length > 0) {
    test.skip(`[${route.app}] ${route.route}`, () => {
      // Documented skip — route covered by tests/api/smoke.spec.ts
    });
    continue;
  }

  const url = APP_BASE[route.app] + fillParams(route.route);
  const role = APP_ROLE[route.app];

  test(`[${route.app}] ${route.route}`, async ({ page, signInAs, networkSpy }) => {
    await signInAs(role);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Page can return 404 for {param} routes whose item doesn't exist; that's
    // fine — the route exists, it's just an empty case.
    expect(
      [200, 404, undefined].includes(response?.status()),
      `unexpected HTTP status ${response?.status()} loading ${url}`,
    ).toBe(true);

    await waitForAppReady(page);

    // The page rendered SOMETHING — proxy assertion is a heading.
    // Some 404 fallbacks render their own h1/h2; that still counts.
    await expect(
      page.locator('h1, h2, [data-testid="page-error"]').first(),
      `no heading or page-error element found at ${url}`,
    ).toBeVisible({ timeout: 5_000 });

    // Network spy violations don't fail the test — see network-spy.ts.
    // They're surfaced via apply-network-spy.ts as a single artifact.
    if (networkSpy.schemaViolations.length > 0) {
      // Annotate the test result so the HTML report shows the count.
      test.info().annotations.push({
        type: 'schema-violation',
        description: `${networkSpy.schemaViolations.length} response(s) failed Zod validation`,
      });
    }
  });
}
