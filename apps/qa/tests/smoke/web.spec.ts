import {
  test,
  expect,
  expectNoConsoleErrors,
  waitForAppReady,
} from '../../fixtures/auth';

/**
 * Web ERP smoke. The hard gate for "the dashboard is reachable and the
 * sidebar still works" — runs on every PR. Anything more nuanced lives in
 * the Phase-2 coverage tier.
 */

test.describe('web smoke (admin)', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('admin');
  });

  test('home page renders without console errors', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Sidebar should render with at least the Work Orders entry — that's
    // the surface every shop manager opens first.
    await expect(page.getByRole('link', { name: /Work Orders/i }).first()).toBeVisible();
    expectNoConsoleErrors(consoleErrors);
  });

  test('every top-level sidebar link navigates somewhere that renders', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // The 10 nav sections defined in apps/web/src/components/SidebarNav.tsx.
    // Match by exact href (in the sidebar `<aside>`) rather than accessible
    // name — the icon span is a separate child and can interfere with role+name.
    const sections = [
      { href: '/work-orders', urlMatch: /\/work-orders$/ },
      { href: '/sales', urlMatch: /\/sales$/ },
      { href: '/inventory', urlMatch: /\/inventory$/ },
      { href: '/customer-dealers', urlMatch: /\/customer-dealers$/ },
      { href: '/training', urlMatch: /\/training$/ },
      { href: '/planning', urlMatch: /\/planning$/ },
      { href: '/accounting', urlMatch: /\/accounting$/ },
      { href: '/messages', urlMatch: /\/messages/ },
      { href: '/reporting', urlMatch: /\/reporting$/ },
      { href: '/admin', urlMatch: /\/admin$/ },
    ];

    for (const section of sections) {
      // Reset to home between sections so the sidebar's "active section
      // expands its children" rule doesn't shove later items off-screen.
      await page.goto('/');
      await waitForAppReady(page);
      const link = page.locator(`aside a[href="${section.href}"]`).first();
      await link.scrollIntoViewIfNeeded();
      await expect(link, `sidebar entry ${section.href} missing`).toBeVisible();
      await link.click();
      await page.waitForURL(section.urlMatch, { timeout: 5_000 });
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    }
    // Console-error cleanliness for these landing pages is asserted in
    // Phase-2 coverage; smoke just confirms navigation works.
  });

  test('copilot button is present in the dashboard footer', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // The 🤖 floating button — proxy for "the global copilot wiring loaded".
    await expect(page.getByRole('button', { name: /Copilot|🤖/ }).first()).toBeVisible();
  });
});
