import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Library fixtures require local storage.');
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();
const bytes = Buffer.from('Paged original');
// Seed real isolated originals, then exercise paging and pairing through the visible interface.
async function seedOriginal(number) {
  const id = randomUUID();
  const request = context.request;
  const headers = { Origin: origin };
  const initialized = await request.post(`${origin}/api/uploads`, { headers, data: { id, name: `library-${String(number).padStart(3, '0')}.raw`, size: bytes.length, mime: 'application/octet-stream', category: 'original', sha256: createHash('sha256').update(bytes).digest('hex') } });
  assert.ok(initialized.ok());
  const { url } = await (await request.post(`${origin}/api/uploads/${id}/part`, { headers, data: { number: 1 } })).json();
  const uploaded = await request.put(new URL(url, origin).href, { headers, data: bytes });
  assert.ok(uploaded.ok());
  const complete = await request.post(`${origin}/api/uploads/${id}/complete`, { headers, data: { parts: [{ partNumber: 1, etag: uploaded.headers().etag.replace(/^"|"$/g, '') }] } });
  assert.ok(complete.ok());
}
try {
  await page.goto(origin);
  await page.getByRole('button', { name: 'Create shared space' }).click();
  await expect(page.getByLabel('Search filenames')).toBeVisible();
  for (let start = 0; start < 50; start += 5) await Promise.all(Array.from({ length: 5 }, (_, offset) => seedOriginal(start + offset)));
  await page.reload();
  await expect(page.locator('article')).toHaveCount(48);
  await page.getByRole('button', { name: 'Load more files' }).click();
  await expect(page.locator('article')).toHaveCount(50);
  assert.equal(new Set(await page.locator('article h3').allTextContents()).size, 50);
  await page.getByLabel('Search filenames').fill('library-000');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('library-000.raw');
  await page.getByRole('button', { name: 'Pair a device', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pair a device', exact: true }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  assert.ok(link.includes('#join='));
  const receiver = await browser.newContext();
  const receiverPage = await receiver.newPage();
  await receiverPage.goto(link);
  await receiverPage.getByLabel('This device', { exact: true }).fill('Paired web receiver');
  await receiverPage.getByRole('button', { name: 'Join shared space' }).click();
  await expect(receiverPage.locator('article')).toHaveCount(48);
  assert.equal(new URL(receiverPage.url()).hash, '');
  await receiver.close();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7659e8'; ctx.fillRect(0, 0, 800, 600); return canvas.toDataURL('image/png').split(',')[1]; });
  await page.getByLabel('Search filenames').fill('preview-fixture');
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'preview-fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const thumbnail = page.locator('article img');
  await expect(thumbnail).toHaveAttribute('src', /\/thumbnail$/, { timeout: 30000 });
  await expect.poll(() => thumbnail.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const item = (await (await context.request.get(`${origin}/api/feed?q=preview-fixture`)).json()).items[0];
  const downloaded = await context.request.get(`${origin}/api/media/${item.id}/download`);
  assert.deepEqual(await downloaded.body(), Buffer.from(png, 'base64'));
  console.log('PASS: 50-original library paging, no duplicates, full-library search, QR/link pairing, lightweight thumbnail, unchanged image original.');
} finally { await browser.close(); }
