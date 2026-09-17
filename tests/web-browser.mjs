import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Browser fixtures require the local test database.');
await mkdir('.sites-runtime/browser-results', { recursive: true });
const payload = Buffer.from('Original media bytes: EXIF, HDR, full resolution.\n');
const { expect } = await import('@playwright/test');

// Exercise actual browser storage, file selection, cookies, downloads and responsive controls.
async function verifyBrowser(engine, options, label) {
  const browser = await engine.launch(options);
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(origin);
    await page.getByLabel('Space name').fill(`Browser verification ${label}`);
    await page.getByLabel('This device', { exact: true }).fill(`${label} desktop`);
    await page.getByRole('button', { name: 'Create shared space' }).click();
    await expect(page.getByLabel('Search filenames')).toBeVisible();
    await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'full-quality.raw', mimeType: 'application/octet-stream', buffer: payload });
    const card = page.locator('article').filter({ hasText: 'full-quality.raw' });
    await expect(card).toBeVisible({ timeout: 30000 });
    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Save to device' }).click();
    const download = await downloadPromise;
    assert.deepEqual(await readFile(await download.path()), payload);
    await page.getByLabel('Search filenames').fill('not-present');
    await expect(page.getByText('No matching files.')).toBeVisible();
    await page.getByLabel('Search filenames').fill('');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Move to Trash' }).click();
    await expect(card).toHaveCount(0);
    await page.locator('.web-tools').getByRole('button', { name: 'Trash (1)', exact: true }).click();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Back to files' }).click();
    await expect(card).toBeVisible();
    await page.locator('.filter-tabs').getByRole('button', { name: /Final cuts/ }).click();
    await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'finished-export.mov', mimeType: 'video/quicktime', buffer: payload });
    await expect(page.locator('article').filter({ hasText: 'finished-export.mov' })).toBeVisible();
    await page.locator('.web-tools').getByRole('button', { name: 'Storage', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('100.0 GB');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss completed transfers' }).click();
    await page.screenshot({ path: `.sites-runtime/browser-results/${label}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Search filenames')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow on phone width');
    await page.screenshot({ path: `.sites-runtime/browser-results/${label}-phone.png`, fullPage: true });
    await page.reload();
    await expect(page.getByLabel('Search filenames')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(2);
    await context.setOffline(true);
    await expect(page.getByText(/Connection interrupted. Your queue/)).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/Connection interrupted. Your queue/)).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${label}: upload, exact-byte download, search, trash/restore, final cut, quota, dialog, responsive layout, persistent pairing, offline feedback.`);
  } finally { await browser.close(); }
}

for (const [engine, options, label] of [[chromium, { channel: 'chrome' }, 'chrome'], [chromium, { channel: 'msedge' }, 'edge'], [firefox, {}, 'firefox'], [webkit, {}, 'webkit']]) {
  await verifyBrowser(engine, options, label);
}
