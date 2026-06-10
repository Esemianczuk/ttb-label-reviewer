import { expect, test } from '@playwright/test';

test('Phase 7 dashboard stays usable without a backend', async ({ page }) => {
  await page.route('http://localhost:8000/api/health', (route) => route.abort());
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Alcohol Label Reviewer' })).toBeVisible();
  await expect(page.getByLabel('Processing Mode')).toBeVisible();
  await expect(page.getByText('Severity-first queue')).toBeVisible();
  await expect(page.getByText('Worker Agents')).toBeVisible();

  await expect(page.getByText('Final Decision')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next Application' }).first()).toBeEnabled();

  await page.keyboard.press('/');
  await expect(page.locator('#batch-search')).toBeFocused();
  await page.locator('#batch-search').fill('bourbon');
  await expect(page.locator('.batch-table tbody tr').first()).toContainText(/bourbon/i);

  await page.getByRole('button', { name: 'Expand Image' }).first().click();
  await expect(page.locator('#floating-viewer')).toBeVisible();
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#floating-viewer')).toHaveCount(0);
});

test('Processing mode can select backend and gracefully fall back', async ({ page }) => {
  await page.route('http://localhost:8000/api/health', (route) => route.abort());
  await page.goto('/');

  await page.getByLabel('Processing Mode').selectOption('backend');
  await expect(page.getByText('Backend offline, browser fallback ready')).toBeVisible();
  await page.getByRole('button', { name: 'Auto Review' }).click();
  await expect(page.getByText('Backend is unavailable. Falling back to Browser Only.')).toBeVisible();
  await expect(page.getByText('Final Decision')).toBeVisible();
});

test('backend mode completes against a live coordinator', async ({ page }) => {
  const backendUrl = process.env.TTB_E2E_BACKEND_URL;
  test.skip(!backendUrl, 'Set TTB_E2E_BACKEND_URL to run the live backend smoke test.');

  await page.addInitScript(
    ({ url }) => {
      window.localStorage.setItem('ttb-reviewer-backend-url', url);
      window.localStorage.setItem('ttb-reviewer-session-id', 'phase7-ui');
    },
    { url: backendUrl },
  );
  await page.goto('/');

  await page.getByLabel('Sample application').selectOption('riverlight-rye-whiskey');
  await expect(page.getByRole('heading', { name: 'Riverlight rye whiskey COLA sheet' })).toBeVisible();
  await page.getByLabel('Processing Mode').selectOption('backend');
  await expect(page.locator('.mode-status').getByText(/Backend online/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Auto Review' }).click();

  await expect(page.getByText('Local backend review queued. Waiting for worker results...')).toBeVisible();
  await expect(page.getByText('Final Decision')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('.result-panel')).toContainText('Pass', { timeout: 90000 });
});
