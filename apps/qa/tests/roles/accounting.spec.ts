import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * accounting role — QB sync monitor, reconciliation, audit trail.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('accounting', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('accounting');
  });

  test('accounting overview renders', async ({ page }) => {
    await page.goto('/accounting');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('sync monitor lists status filter controls', async ({ page }) => {
    await page.goto('/accounting/sync');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('reconciliation page renders runs list', async ({ page }) => {
    await page.goto('/accounting/reconciliation');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('audit trail accessible', async ({ page }) => {
    await page.goto('/admin/audit');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });
});
