import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const browserRoot = new URL('../..', import.meta.url).pathname;

function fixtureImage(relativePath, name) {
  return {
    name,
    mimeType: 'image/png',
    buffer: readFileSync(join(browserRoot, 'public', relativePath)),
  };
}

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

test('CSV manifest upload creates one application row per image', async ({ page }) => {
  await page.route('http://localhost:8000/api/health', (route) => route.abort());
  await page.goto('/');

  const manifest = [
    'filename,applicationId,brandName,classType,alcoholContent,netContents,governmentWarningRequired,producerName',
    'hollow.png,CSV-1,HOLLOW RIDGE,Kentucky Straight Bourbon Whiskey,45% ALC/VOL (90 PROOF),750 mL,true,Sunset Ridge Spirits',
    'gin.png,CSV-2,HIGHLAND COAST,Distilled Spirits Specialty,47% ALC/VOL (94 PROOF),750 mL,true,Highland Coast Distilling',
  ].join('\n');

  await page.locator('#image-input').setInputFiles([
    fixtureImage('label-packets/hollow-ridge-bourbon/cola-sheet.png', 'hollow.png'),
    fixtureImage('label-packets/highland-coast-lightkeeper-gin/cola-sheet.png', 'gin.png'),
    { name: 'manifest.csv', mimeType: 'text/csv', buffer: Buffer.from(manifest) },
  ]);

  await expect(page.getByText('Uploaded application 1 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HOLLOW RIDGE' })).toBeVisible();
  await expect(page.locator('.batch-table')).toContainText('CSV-1');
  await expect(page.locator('.batch-table')).toContainText('CSV-2');

  await page.getByRole('button', { name: 'Next Application' }).first().click();
  await expect(page.getByText('Uploaded application 2 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HIGHLAND COAST' })).toBeVisible();
  await expect(page.locator('input[name="applicationId"]')).toHaveValue('CSV-2');

  await page.getByRole('button', { name: 'Previous' }).first().click();
  await expect(page.locator('input[name="applicationId"]')).toHaveValue('CSV-1');
});

test('agent override flow recalculates and exports reviewer notes', async ({ page }) => {
  await page.route('http://localhost:8000/api/health', (route) => route.abort());
  await page.goto('/');

  await expect(page.getByText('Final Decision')).toBeVisible();
  await page.keyboard.press('F');
  await expect(page.locator('.result-panel')).toContainText('Fail');
  await page.locator('.agent-note').first().fill('Audit note: label evidence is insufficient.');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const report = JSON.parse(readFileSync(await download.path(), 'utf8'));

  expect(report.fields[0].finalStatus).toBe('FAIL');
  expect(report.fields[0].agentNote).toBe('Audit note: label evidence is insufficient.');
});

test('backend mode completes against a live coordinator', async ({ page }) => {
  const backendUrl = process.env.TTB_E2E_BACKEND_URL;
  test.skip(!backendUrl, 'Set TTB_E2E_BACKEND_URL to run the live backend smoke test.');
  test.setTimeout(120000);
  const sessionId = process.env.TTB_E2E_SESSION_ID || 'local-dev-session';

  await page.addInitScript(
    ({ url, sessionId }) => {
      window.localStorage.setItem('ttb-reviewer-backend-url', url);
      window.localStorage.setItem('ttb-reviewer-session-id', sessionId);
    },
    { url: backendUrl, sessionId },
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

test('browser-only OCR smoke runs with packaged worker assets', async ({ page }) => {
  const enabled = process.env.TTB_E2E_BROWSER_OCR === '1' || process.env.RUN_SLOW_OCR === '1';
  test.skip(!enabled, 'Set TTB_E2E_BROWSER_OCR=1 to run the slow packaged browser OCR smoke test.');
  test.setTimeout(120000);

  await page.route('http://localhost:8000/api/health', (route) => route.abort());
  await page.goto('/');

  await page.locator('#image-input').setInputFiles([
    fixtureImage('label-packets/hollow-ridge-bourbon/cola-sheet.png', 'hollow-ridge-cola-sheet.png'),
  ]);

  await expect(page.getByText('Uploaded application 1 of 1')).toBeVisible();
  await page.getByRole('button', { name: 'Auto Review' }).click();
  await expect(page.getByText(/Using browser worker pool OCR|Preparing browser OCR|Processing 1 image/).first()).toBeVisible();
  await expect(page.getByText('Final Decision')).toBeVisible({ timeout: 120000 });
});
