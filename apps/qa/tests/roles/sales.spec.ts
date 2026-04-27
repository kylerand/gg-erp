import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * sales role — pipeline kanban, quotes, forecast, customer directory.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('sales', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('sales');
  });

  test('sales dashboard with KPIs renders', async ({ page }) => {
    await page.goto('/sales');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('pipeline kanban loads', async ({ page }) => {
    await page.goto('/sales/pipeline');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('quotes list page renders', async ({ page }) => {
    await page.goto('/sales/quotes');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('forecast page renders', async ({ page }) => {
    await page.goto('/sales/forecast');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('customers directory accessible', async ({ page }) => {
    await page.goto('/customer-dealers/customers');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });
});
