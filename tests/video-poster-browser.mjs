import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, webkit, expect } from '@playwright/test';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await (process.env.RELAY_POSTER_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const bytes = await readFile('tests/fixtures/poster-video.mov');
// Windows WebKit cannot decode every QuickTime container; test that fallback explicitly.
const decodesMov = await page.evaluate(async bytes => {
  const video = document.createElement('video');
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/quicktime' }));
  try {
    return await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 4000);
      video.onloadedmetadata = () => { clearTimeout(timeout); resolve(true); };
      video.onerror = () => { clearTimeout(timeout); resolve(false); };
      video.src = url;
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}, Array.from(bytes));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Reproduce iPhone's metadata-only preload: old code waiting for loadeddata would never finish.
await page.addInitScript(() => {
  const listen = HTMLMediaElement.prototype.addEventListener;
  HTMLMediaElement.prototype.addEventListener = function(type, ...args) { if (type !== 'loadeddata') return listen.call(this, type, ...args); };
});
try {
  await page.goto(`${origin}/?view=files`);
  await page.getByLabel('Space name').fill('MOV thumbnail fixture');
  await page.getByRole('button', { name: 'Create shared space', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add files', exact: true }).first()).toBeEnabled();
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'New iPhone.MOV', mimeType: 'video/quicktime', buffer: bytes });
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 30000 });
  const firstCard = page.locator('article').filter({ hasText: 'New iPhone.MOV' });
  if (decodesMov) await expect(firstCard.locator('img')).toBeVisible({ timeout: 15000 });
  else await expect(firstCard).toContainText('Thumbnail unavailable', { timeout: 25000 });
  const firstFeed = await (await page.request.get(`${origin}/api/feed`)).json();
  assert.equal(Boolean(firstFeed.items[0].hasPreview), decodesMov, 'Poster is persisted after upload');
  // Seed an existing original with no poster, exercising gallery repair independently of upload.
  const id = randomUUID();
  const metadata = { id, name: 'Existing iPhone.MOV', mime: 'video/quicktime', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), category: 'original' };
  const upload = await page.request.post(`${origin}/api/uploads`, { headers: { origin }, data: metadata });
  assert.equal(upload.status(), 200);
  const part = await (await page.request.post(`${origin}/api/uploads/${id}/part`, { headers: { origin }, data: { number: 1 } })).json();
  const sent = await page.request.put(new URL(part.url, origin).href, { headers: { origin }, data: bytes });
  assert.equal(sent.status(), 200);
  const completed = await page.request.post(`${origin}/api/uploads/${id}/complete`, { headers: { origin }, data: { parts: [{ partNumber: 1, etag: sent.headers().etag.replaceAll('"', '') }] } });
  assert.equal(completed.status(), 200);
  await page.reload();
  const existingCard = page.locator('article').filter({ hasText: 'Existing iPhone.MOV' });
  if (decodesMov) {
  await expect(existingCard.locator('img')).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await (await page.request.get(`${origin}/api/feed`)).json()).items.find(item => item.id === id)?.hasPreview).toBeTruthy();
  await page.reload();
  await expect(existingCard.locator('img')).toBeVisible();
  } else await expect(existingCard).toContainText('Thumbnail unavailable', { timeout: 25000 });
  const download = await page.request.get(`${origin}/api/media/${id}/download`);
  assert.deepEqual(await download.body(), bytes);
  assert.deepEqual(errors, []);
  console.log(decodesMov ? 'PASS: MOV upload poster with metadata-only preload, existing-video repair, durable JPEG after reload, exact original bytes.' : 'PASS: unavailable platform MOV decoder gives explicit fallback, leaves originals intact, and does not mark a thumbnail ready.');
} finally { await browser.close(); }
