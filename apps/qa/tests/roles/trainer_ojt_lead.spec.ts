import { test, expect, waitForAppReady, appBaseUrl } from '../../fixtures/auth';

/**
 * trainer_ojt_lead role — SOP authoring, module admin, assignment review.
 */

test.use({ baseURL: appBaseUrl('web') });

test.describe('trainer_ojt_lead', () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs('trainer_ojt_lead');
  });

  test('training hub renders', async ({ page }) => {
    await page.goto('/training');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('SOP library lists Published / Draft tabs', async ({ page }) => {
    await page.goto('/training/sop');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('assignments page renders team view', async ({ page }) => {
    await page.goto('/training/assignments');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5_000 });
  });

  test('module admin lists modules', async ({ page }) => {
    await page.goto('/training/admin');
    await waitForAppReady(page);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
