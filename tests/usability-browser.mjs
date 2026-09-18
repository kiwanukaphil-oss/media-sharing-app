import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Delayed and failed reads must never masquerade as an empty library or enable uploads into Trash.
try {
  await page.route('**/api/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary interruption' }) }));
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.getByText('Bring this device along.', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Create shared space' }).click();
  await expect(page.getByLabel('Search filenames')).toBeVisible();
  await page.getByRole('button', { name: 'How Relay works', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A simple way to pass it on.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'How Relay works', exact: true })).toBeFocused();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/feed?*', async route => {
    if (new URL(route.request().url()).searchParams.get('category') === 'final') {
      await gate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary service interruption' }) });
    } else await route.continue();
  });
  await page.locator('.filter-tabs').getByRole('button', { name: /Final cuts/ }).click();
  await expect(page.getByText('Loading files...', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready for the final touch.', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Retry loading files' })).toBeVisible();
  await expect(page.getByText('Ready for the final touch.', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/feed?*');
  await page.getByRole('button', { name: 'Retry loading files' }).click();
  await expect(page.getByText('Ready for the final touch.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trash (0)', exact: true }).click();
  await expect(page.getByText('Nothing in Trash.', { exact: true })).toBeVisible();
  await expect(page.locator('.drop-zone')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toHaveCount(0);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'trash-guard.raw', mimeType: 'application/octet-stream', buffer: Buffer.from('do not upload') });
  await expect(page.getByRole('region', { name: 'File transfers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to files' }).click();
  await expect(page.locator('.drop-zone')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile layout must not overflow.');
  assert.deepEqual(errors, []);
  console.log('Usability checks passed: mobile help/focus, delayed feed, error recovery, Trash upload guard, mobile width.');
} finally { await browser.close(); }
