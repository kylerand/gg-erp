import { defineConfig, devices } from '@playwright/test';

/**
 * QA harness for the three Golfin Garage Next.js apps + the dev API Gateway.
 *
 * Projects are organized by tier (smoke / coverage / roles / a11y / visual)
 * × app (web / floor-tech / training / api). Phase 1 ships the smoke tier.
 *
 * Local runs assume the dev servers are already up:
 *   web        → http://localhost:3010
 *   floor-tech → http://localhost:3012
 *   training   → http://localhost:3013
 *
 * Boot them with `NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port <N>` from
 * each app workspace, or via `scripts/demo/run.sh` which handles all three.
 *
 * The dev API Gateway lives at https://xvkc7v8hue.execute-api.us-east-2.amazonaws.com
 * (override via env QA_API_BASE_URL).
 */

const WEB_URL = process.env.QA_WEB_URL ?? 'http://localhost:3010';
const FLOOR_TECH_URL = process.env.QA_FLOOR_TECH_URL ?? 'http://localhost:3012';
const TRAINING_URL = process.env.QA_TRAINING_URL ?? 'http://localhost:3013';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],

  use: {
    actionTimeout: 7_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    deviceScaleFactor: 2,
  },

  projects: [
    // ─── Smoke tier (Phase 1) ───────────────────────────────────────────────
    {
      name: 'smoke-web',
      testMatch: /smoke\/web\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_URL,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'smoke-floor-tech',
      testMatch: /smoke\/floor-tech\.spec\.ts$/,
      use: {
        // Chromium with an iPhone 14-class viewport. We don't need WebKit's
        // engine-specific quirks for smoke; reserved for visual-regression tier.
        ...devices['Desktop Chrome'],
        baseURL: FLOOR_TECH_URL,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'smoke-training',
      testMatch: /smoke\/training\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: TRAINING_URL,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'smoke-api',
      testMatch: /api\/smoke\.spec\.ts$/,
      // No browser needed for pure HTTP smoke; APIRequestContext handles it.
      use: {},
    },

    // ─── Coverage tier (Phase 2) ───────────────────────────────────────────
    {
      name: 'coverage',
      testMatch: /coverage\/.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
