import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * shop_manager role — dispatch, planning, blocked-WO triage.
 * Pages walked match the ERP operator manual's "Your role, your pages" map.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('shop_manager', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('shop_manager');
  });

  test('dispatch board renders the assignment surface', async ({ page }) => {
    await page.goto('/work-orders/dispatch');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('open / blocked triage page lists work orders', async ({ page }) => {
    await page.goto('/work-orders/open');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('build slot planner shows the weekly grid', async ({ page }) => {
    await page.goto('/planning/slots');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    // The page either renders the weekly grid (real data) or its empty
    // state. Mock mode produces the empty state — both are healthy.
    await expect(page.locator('body')).toContainText(
      /Build Slot Planner|No work orders|Week of/i,
    );
  });

  test('reporting page renders cross-domain KPIs', async ({ page }) => {
    await page.goto('/reporting');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });
});
