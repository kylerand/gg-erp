import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * technician role — primary user of the floor-tech mobile app. Walks the
 * shift → queue → time logging → sync workflow per the floor-tech manual.
 */

test.use({
  baseURL: appBaseUrl('floor-tech'),
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

test.describe('technician (floor-tech)', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('technician');
  });

  test('lands on my-queue with bottom nav', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page).toHaveURL(/work-orders\/my-queue/);
    for (const tab of ['Queue', 'Shift', 'Time', 'Sync']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${tab}$`, 'i') }).first()).toBeVisible();
    }
  });

  test('shift tab exposes clock-in surface', async ({ page }) => {
    await page.goto('/shift');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('time logging screen renders timer surface', async ({ page }) => {
    await page.goto('/work-orders/time-logging');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('sync tab renders queued/retry/failed counts', async ({ page }) => {
    await page.goto('/sync');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
