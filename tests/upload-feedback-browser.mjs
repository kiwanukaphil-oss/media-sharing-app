import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, webkit, expect } from '@playwright/test';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await (process.env.RELAY_UPLOAD_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// Exercise the universal native-input fallback; remembered desktop handles have separate acceptance.
await page.addInitScript(() => { window.showOpenFilePicker = undefined; });
const uploads = [];
const errors = [];
let workers = 0;
page.on('worker', () => workers++);
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/uploads') uploads.push(request.postDataJSON()); });
try {
  await page.goto(`${origin}/?view=files`);
  await page.getByLabel('Space name').fill('Upload feedback fixture');
  await page.getByRole('button', { name: 'Create shared space', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
  // Hold worker loading to reproduce slow preparation while verifying the whole selection is visible.
  let releasePreparation;
  const preparationGate = new Promise(resolve => { releasePreparation = resolve; });
  await page.route('**/hash-original.worker-*.js', async route => { await preparationGate; await route.continue(); });
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Waiting for selected files');
  const originals = [3, 33, 3].map(size => Buffer.alloc(size * 1024 * 1024 + 17, 83));
  await (await picker).setFiles([1, 2, 3].map(number => ({ name: `Original ${number}.dng`, mimeType: 'application/octet-stream', buffer: originals[number - 1] })));
  await expect(page.locator('.upload-drawer')).toHaveCount(0);
  await page.locator('.upload-indicator').click();
  await expect(page.locator('.transfer-row')).toHaveCount(3);
  await expect(page.getByText('Preparing original', { exact: true })).toBeVisible();
  await expect(page.getByText('Queued', { exact: true })).toHaveCount(2);
  await expect(page.locator('.upload-footnote')).toContainText('locking your phone');
  assert.equal(uploads.length, 0);
  releasePreparation();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 60000 });
  assert.equal(workers, 3, 'Each original is checked in an actual browser worker');
  assert.equal(uploads.length, 3);
  for (const upload of uploads) {
    const bytes = originals[Number(upload.name.match(/Original (\d)/)[1]) - 1];
    assert.equal(upload.sha256, createHash('sha256').update(bytes).digest('hex'));
    const downloaded = await page.request.get(`${origin}/api/media/${upload.id}/download`);
    assert.equal(downloaded.status(), 200);
    assert.deepEqual(await downloaded.body(), bytes);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mobile selection feedback, visible full queue during slow preparation, real hash workers and exact original bytes.');
} finally { await browser.close(); }
