import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * parts_manager role — inventory, reservations, receiving, manufacturers,
 * stage-planning shortage report.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('parts_manager', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('parts_manager');
  });

  test('part lookup renders catalog', async ({ page }) => {
    await page.goto('/inventory/parts');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('manufacturers list loads', async ({ page }) => {
    await page.goto('/inventory/manufacturers');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('reservations page reachable', async ({ page }) => {
    await page.goto('/inventory/reservations');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('receiving page reachable', async ({ page }) => {
    await page.goto('/inventory/receiving');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('stage planning shortage report renders', async ({ page }) => {
    await page.goto('/inventory/planning');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
