import {
  test,
  expect,
  expectNoConsoleErrors,
  waitForAppReady,
} from '../../fixtures/auth';

/**
 * Floor Tech smoke. Validates the four-tab bottom-nav loads on iPhone-14
 * viewport and the queue page renders for a technician.
 */

test.describe('floor-tech smoke (technician)', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('technician');
  });

  test('home redirects into my-queue and bottom nav renders', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Root redirects to the queue (per apps/floor-tech/src/app/page.tsx).
    await expect(page).toHaveURL(/work-orders\/my-queue/, { timeout: 5_000 });

    // All four bottom-nav tabs should be visible — the contract for the
    // floor tech UI is "always-on bottom nav with Queue / Shift / Time / Sync".
    for (const label of ['Queue', 'Shift', 'Time', 'Sync']) {
      await expect(
        page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') }).first(),
      ).toBeVisible();
    }

    expectNoConsoleErrors(consoleErrors);
  });

  test('bottom nav tabs navigate to their pages', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const tabs = [
      { label: 'Shift', urlMatch: /\/shift$/ },
      { label: 'Time', urlMatch: /\/time-logging/ },
      { label: 'Sync', urlMatch: /\/sync$/ },
      { label: 'Queue', urlMatch: /\/work-orders\/my-queue/ },
    ];

    for (const tab of tabs) {
      const link = page.getByRole('link', { name: new RegExp(`^${tab.label}$`, 'i') }).first();
      await link.click();
      await page.waitForURL(tab.urlMatch, { timeout: 5_000 });
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    }

    expectNoConsoleErrors(consoleErrors);
  });
});
