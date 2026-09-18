import assert from 'node:assert/strict';
import { chromium, firefox, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Reuse only the isolated verification-space credential; never log cookies or signed URLs.
const { origin, cookie } = JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8'));
const separator = cookie.indexOf('=');
const browserCookie = { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, secure: true, sameSite: 'Strict' };
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([browserCookie]);
await context.addInitScript(() => {
  window.testSavedOriginal = { chunks: [], closed: false, aborted: false };
  Object.defineProperty(window, 'showSaveFilePicker', { value: async () => ({ createWritable: async () => ({
    write: async bytes => window.testSavedOriginal.chunks.push(Array.from(new Uint8Array(bytes))),
    close: async () => { window.testSavedOriginal.closed = true; },
    abort: async () => { window.testSavedOriginal.aborted = true; },
  }) }) });
});
const page = await context.newPage();
page.on('dialog', dialog => dialog.accept());
const fixtureName = `web-release-${randomUUID()}.png`;
try {
  const session = await (await context.request.get(`${origin}/api/session`)).json();
  assert.equal(session.space.name, 'Relay verification', 'Never mutate the owner workspace in release tests');
  assert.equal(session.role, 'owner', 'The verification credential must be an owner after migration.');
  await page.goto(origin);
  await expect(page.getByLabel('Search filenames')).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ece6ff'; ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = '#7258db'; ctx.fillRect(140, 130, 620, 340); ctx.fillStyle = '#ffffff';
    ctx.font = '44px sans-serif'; ctx.fillText('Original quality. Verified.', 190, 320);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const original = Buffer.from(png, 'base64');
  await page.getByLabel('Search filenames').fill(fixtureName);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: fixtureName, mimeType: 'image/png', buffer: original });
  const card = page.locator('article').filter({ hasText: fixtureName });
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(card.locator('img')).toHaveAttribute('src', /\/thumbnail$/, { timeout: 30000 });
  await card.getByRole('button', { name: 'Save to device' }).click();
  await expect(page.getByText('Saved to your device. Original file verified.')).toBeVisible({ timeout: 30000 });
  const saved = await page.evaluate(() => window.testSavedOriginal);
  assert.equal(saved.closed, true); assert.equal(saved.aborted, false);
  assert.deepEqual(Buffer.from(saved.chunks.flat()), original);
  const storage = await (await context.request.get(`${origin}/api/storage`)).json();
  assert.equal(storage.limit, 100 * 1024 ** 3);
  const fallbackBrowser = await firefox.launch();
  try {
    const fallback = await fallbackBrowser.newContext({ acceptDownloads: true });
    await fallback.addCookies([browserCookie]);
    const fallbackPage = await fallback.newPage(); await fallbackPage.goto(origin);
    await fallbackPage.getByLabel('Search filenames').fill(fixtureName);
    const target = fallbackPage.locator('article').filter({ hasText: fixtureName });
    await expect(target).toBeVisible();
    const pending = fallbackPage.waitForEvent('download');
    await target.getByRole('button', { name: 'Save to device' }).click();
    assert.deepEqual(await readFile(await (await pending).path()), original);
  } finally { await fallbackBrowser.close(); }
  await page.getByRole('button', { name: 'Dismiss completed transfers' }).click();
  await page.screenshot({ path: '.sites-runtime/browser-results/hosted-web-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.sites-runtime/browser-results/hosted-web-phone.png', fullPage: true });
  await card.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(card).toHaveCount(0);
  await page.locator('.sidebar').getByRole('button', { name: /^Trash/ }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Back to files' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(card).toHaveCount(0);
  await page.locator('.sidebar').getByRole('button', { name: /^Trash/ }).click();
  await card.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(card).toHaveCount(0);
  console.log('PASS hosted web: real direct R2 image upload, thumbnail, verified streaming bytes (test writable), Firefox attachment download, 100 GiB quota, responsive UI, trash/restore and explicit test-fixture deletion.');
} finally { await browser.close(); }
