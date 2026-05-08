import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * admin role — full platform access. Walks the user-management,
 * audit-trail, and integration-health surfaces per the ERP operator manual.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('admin', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('admin');
  });

  test('opens user access and sees the invite control', async ({ page }) => {
    await page.goto('/admin/access');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    // The "+ Invite User" control is the marquee admin action.
    await expect(
      page.getByRole('button', { name: /Invite User|\+ Invite/i }).first(),
    ).toBeVisible();
  });

  test('audit trail lists privileged actions', async ({ page }) => {
    await page.goto('/admin/audit');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    // Audit body renders something — header column copy or an empty state.
    await expect(page.locator('body')).toContainText(/Timestamp|Actor|Outcome|No audit events/i);
  });

  test('integration health surfaces live accounting connector cards', async ({ page }) => {
    await page.goto('/admin/integrations');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/QuickBooks Online/i).first()).toBeVisible();
    await expect(page.getByText(/Integration Accounts/i).first()).toBeVisible();
    await expect(page.getByText(/Invoice Sync Failures/i).first()).toBeVisible();
    await expect(page.getByText(/Customer Sync Queue/i).first()).toBeVisible();
    await expect(page.getByText(/Reconciliation Runs/i).first()).toBeVisible();
  });
});
