import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * read_only_executive role — read-only access. Smoke its primary tile
 * (reporting) and confirm it can land on cross-domain pages without write
 * controls being hard-required.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('read_only_executive', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('read_only_executive');
  });

  test('reporting page renders cross-domain KPIs', async ({ page }) => {
    await page.goto('/reporting');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('work orders open/blocked is visible', async ({ page }) => {
    await page.goto('/work-orders/open');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('inventory parts catalog is visible', async ({ page }) => {
    await page.goto('/inventory/parts');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
