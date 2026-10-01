import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));

// The picker returns a real serializable handle; only the OS picker and permission prompt are simulated.
await page.addInitScript(() => {
  let permissionGranted = !sessionStorage.getItem('test-require-file-permission');
  FileSystemFileHandle.prototype.queryPermission = async () => permissionGranted ? 'granted' : 'prompt';
  FileSystemFileHandle.prototype.requestPermission = async () => {
    if (!navigator.userActivation.isActive) throw new Error('File access requires the button gesture');
    permissionGranted = true; return 'granted';
  };
  window.showOpenFilePicker = async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('handle-recovery.raw', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(1024 * 1024).fill(39)); await writable.close();
    return [handle];
  };
});
try {
  await page.goto(`${origin}/?view=files`);
  await page.getByLabel('Space name').fill('Native handle recovery fixture');
  await page.getByRole('button', { name: 'Create shared space', exact: true }).click();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/uploads/*/bytes/*', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('File access remembered', { exact: true })).toBeVisible();
  await expect(page.getByText('Uploading', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause handle-recovery.raw', exact: true }).click();
  await page.evaluate(() => sessionStorage.setItem('test-require-file-permission', 'true'));
  release(); await page.unroute('**/uploads/*/bytes/*');
  await page.reload();
  await expect(page.locator('.upload-drawer')).toHaveCount(0);
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('File access needed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow file access', exact: true }).click();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 30000 });
  const feed = await (await page.request.get(`${origin}/api/feed`)).json();
  assert.deepEqual(await (await page.request.get(`${origin}/api/media/${feed.items[0].id}/download`)).body(), Buffer.alloc(1024 * 1024, 39));
  assert.deepEqual(errors, []);
  console.log('PASS: real serialized file handle, no source copy, quiet reload, permission renewal from a user gesture and exact original bytes.');
} finally { await browser.close(); }
