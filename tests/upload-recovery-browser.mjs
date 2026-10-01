import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', failure => errors.push(failure.message));

// Create a real isolated library; no production accounts, data or signing credentials are used.
async function createLibrary(target) {
  await target.goto(`${origin}/?view=files`);
  await target.getByLabel('Space name').fill('Upload recovery boundary fixture');
  await target.getByRole('button', { name: 'Create shared space', exact: true }).click();
  await expect(target.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
}

try {
  await createLibrary(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/uploads/*/bytes/*', async route => { await gate; await route.continue().catch(() => {}); });
  const large = Buffer.alloc(33 * 1024 * 1024 + 1, 23);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'large-original.raw', mimeType: 'application/octet-stream', buffer: large });
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('Uploading', { exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Pause large-original.raw', exact: true }).click();
  await expect(page.locator('.upload-row')).toContainText('Paused');
  release(); await page.unroute('**/uploads/*/bytes/*');
  await page.reload();
  await expect(page.locator('.upload-indicator')).toBeVisible();
  await expect(page.locator('.upload-drawer')).toHaveCount(0);
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('Original needed', { exact: true })).toBeVisible();
  await page.getByLabel('Locate original files', { exact: true }).setInputFiles({ name: 'large-original.raw', mimeType: 'application/octet-stream', buffer: Buffer.alloc(large.length, 24) });
  await expect(page.getByRole('status')).toContainText('0 matched', { timeout: 45000 });
  await expect(page.getByText('Original needed', { exact: true })).toBeVisible();
  await page.getByLabel('Locate original files', { exact: true }).setInputFiles({ name: 'renamed-original.raw', mimeType: 'application/octet-stream', buffer: large });
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 45000 });
  const feed = await (await page.request.get(`${origin}/api/feed`)).json();
  assert.deepEqual(await (await page.request.get(`${origin}/api/media/${feed.items[0].id}/download`)).body(), large);
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  // A second tab can observe a job but must not acquire its active transfer lock or send it twice.
  let releaseSecond;
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  await page.route('**/uploads/*/bytes/*', async route => { await secondGate; await route.continue().catch(() => {}); });
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'shared-tab.raw', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024 * 1024, 56) });
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('Uploading', { exact: true })).toBeVisible();
  const observer = await context.newPage();
  let duplicateAdmissions = 0;
  observer.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/uploads') duplicateAdmissions++; });
  await observer.goto(`${origin}/uploads`);
  await expect(observer.getByText('Uploading in another tab', { exact: true })).toBeVisible({ timeout: 15000 });
  assert.equal(duplicateAdmissions, 0);
  releaseSecond(); await page.unroute('**/uploads/*/bytes/*');
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible();
  await observer.getByRole('button', { name: 'Resume shared-tab.raw', exact: true }).click();
  await expect(observer.getByText('All files delivered', { exact: true })).toBeVisible();
  assert.equal(duplicateAdmissions, 0);
  await observer.close();
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  // Denied browser storage must degrade to an honest in-session transfer, not prevent uploading.
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => { if (name.startsWith('relay-')) throw new DOMException('Storage denied', 'SecurityError'); return original(name, version); };
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'without-storage.raw', mimeType: 'application/octet-stream', buffer: Buffer.from('original survives unavailable recovery storage') });
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log('PASS: session-only large-original recovery, same-size wrong-byte rejection, renamed hash match, exact bytes, exclusive multi-tab sending and storage-denial fallback.');
} finally { await browser.close(); }
