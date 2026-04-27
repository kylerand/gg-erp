import { test, expect, waitForAppReady } from '../../fixtures/auth';

/**
 * Training app smoke. Validates the standalone technician training surface
 * loads, redirects to /modules, and renders the catalog.
 */

test.describe('training smoke (technician)', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('technician');
  });

  test('home redirects into modules catalog', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/modules$/, { timeout: 5_000 });
    // Catalog header should render even if no modules are seeded.
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('top-level pages render', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const routes = ['/modules', '/my-progress', '/assignments'];
    for (const route of routes) {
      await page.goto(route);
      await waitForAppReady(page);
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
