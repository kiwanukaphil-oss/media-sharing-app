import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, firefox, webkit, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const engineName = process.env.RELAY_UPLOAD_BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engineName]).launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(20000);
const errors = [];
page.on('pageerror', failure => errors.push(failure.message));
const sent = [];
page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/uploads') sent.push(request.postDataJSON()); });
await mkdir('outputs/upload-workflow-live', { recursive: true });

// Check actual uploads through navigation, reload, cache recovery and a lost completion response.
try {
  await page.goto(`${origin}/?view=files`);
  await page.getByLabel('Space name').fill(`Upload workflow ${engineName}`);
  await page.getByRole('button', { name: 'Create shared space', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
  await page.evaluate(() => { window.uploadContinuityMarker = 'same-document'; });
  let releaseHash;
  const holdHash = new Promise(resolve => { releaseHash = resolve; });
  await page.route('**/hash-original.worker-*.js', async route => { await holdHash; await route.continue().catch(() => {}); });
  const first = Buffer.alloc(3 * 1024 * 1024 + 17, 71);
  const second = Buffer.alloc(1024 * 1024 + 9, 93);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles([
    { name: 'trip-one.raw', mimeType: 'application/octet-stream', buffer: first },
    { name: 'trip-two.raw', mimeType: 'application/octet-stream', buffer: second },
  ]);
  await expect(page.locator('.upload-indicator')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Upload details' })).toHaveCount(0);
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('Preparing original', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause trip-two.raw', exact: true }).click();
  await expect(page.locator('.upload-row').filter({ hasText: 'trip-two.raw' })).toContainText('Paused');
  await page.getByRole('button', { name: 'Hide upload details', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toBeFocused();
  await page.locator('.topbar-right').getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page).toHaveURL(/\/account/);
  assert.equal(await page.evaluate(() => window.uploadContinuityMarker), 'same-document');
  releaseHash();
  await expect(page.locator('.upload-indicator')).toContainText('Paused', { timeout: 45000 });
  await page.locator('.upload-indicator').click();
  await page.getByRole('button', { name: 'Resume trip-two.raw', exact: true }).click();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 45000 });
  for (const upload of sent) {
    const response = await page.request.get(`${origin}/api/media/${upload.id}/download`);
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.body(), upload.name === 'trip-one.raw' ? first : second);
    const receipt = await page.request.get(`${origin}/api/uploads/${upload.id}`);
    assert.equal((await receipt.json()).status, 'ready');
    assert.equal(receipt.headers()['cache-control'], 'no-store');
  }
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  console.log('Navigation and exact-byte delivery passed. Checking reload recovery.');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
  // Pause after original retention, then reload; resuming must not open a file picker.
  let releaseBytes;
  const holdBytes = new Promise(resolve => { releaseBytes = resolve; });
  await page.route('**/uploads/*/bytes/*', async route => { await holdBytes; await route.continue().catch(() => {}); });
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'recovery.raw', mimeType: 'application/octet-stream', buffer: first });
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('Uploading', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Recovery copy saved on this device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause recovery.raw', exact: true }).click();
  await expect(page.locator('.upload-row').getByText('Paused', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const opening = indexedDB.open('relay-transfers');
    opening.onsuccess = () => { const db = opening.result, reading = db.transaction('transfers').objectStore('transfers').getAll(); reading.onsuccess = () => { resolve(reading.result.find(job => job.name === 'recovery.raw')?.userPaused); db.close(); }; };
  }))).toBe(true);
  releaseBytes();
  await page.unroute('**/uploads/*/bytes/*');
  await page.reload();
  console.log('Reload complete. Checking saved source.');
  await expect(page.locator('.upload-indicator')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Upload details' })).toHaveCount(0);
  await page.locator('.upload-indicator').click();
  await expect(page.locator('.upload-row').getByText('Paused', { exact: true })).toBeVisible();
  let filePickers = 0; page.on('filechooser', () => filePickers++);
  await page.getByRole('button', { name: 'Resume recovery.raw', exact: true }).click();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 45000 });
  assert.equal(filePickers, 0);
  console.log('Source recovery passed. Checking lost completion response.');
  const recovered = sent.find(entry => entry.name === 'recovery.raw');
  assert.deepEqual(await (await page.request.get(`${origin}/api/media/${recovered.id}/download`)).body(), first);
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  // Commit server-side, then lose the response: automatic reconciliation must detect the receipt.
  let lost = false;
  await page.route('**/uploads/*/complete', async route => {
    if (!lost) { lost = true; const result = await route.fetch(); assert.equal(result.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'lost-receipt.raw', mimeType: 'application/octet-stream', buffer: second });
  await page.locator('.upload-indicator').click();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 45000 });
  assert.ok(lost);
  await page.unroute('**/uploads/*/complete');
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  // Losing the network resumes active work, while a deliberate pause remains paused.
  let releaseOffline;
  const offlineGate = new Promise(resolve => { releaseOffline = resolve; });
  await page.route('**/uploads/*/bytes/*', async route => { await offlineGate; await route.continue().catch(() => {}); });
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles([
    { name: 'network-loss.raw', mimeType: 'application/octet-stream', buffer: first },
    { name: 'deliberate-pause.raw', mimeType: 'application/octet-stream', buffer: second },
  ]);
  await page.locator('.upload-indicator').click();
  await page.getByRole('button', { name: 'Pause deliberate-pause.raw', exact: true }).click();
  await expect(page.getByText('Uploading', { exact: true })).toBeVisible({ timeout: 30000 });
  await context.setOffline(true);
  await expect(page.locator('.upload-row').filter({ hasText: 'network-loss.raw' })).toContainText('Waiting for connection');
  releaseOffline();
  await page.unroute('**/uploads/*/bytes/*');
  await context.setOffline(false);
  await expect(page.locator('.upload-row').filter({ hasText: 'network-loss.raw' })).toContainText('Uploaded', { timeout: 45000 });
  await expect(page.locator('.upload-row').filter({ hasText: 'deliberate-pause.raw' })).toContainText('Paused');
  await page.getByRole('button', { name: 'Cancel deliberate-pause.raw', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(page.locator('.upload-row').filter({ hasText: 'deliberate-pause.raw' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  // A cancellation click after server publication must keep the delivered original.
  let committed = false;
  let releaseCompletion;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  await page.route('**/uploads/*/complete', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200); committed = true;
    await completionGate; await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'cancel-after-commit.raw', mimeType: 'application/octet-stream', buffer: second });
  await page.locator('.upload-indicator').click();
  await expect.poll(() => committed, { timeout: 45000 }).toBe(true);
  await page.getByRole('button', { name: 'Cancel cancel-after-commit.raw', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  releaseCompletion();
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 45000 });
  const published = sent.find(entry => entry.name === 'cancel-after-commit.raw');
  assert.deepEqual(await (await page.request.get(`${origin}/api/media/${published.id}/download`)).body(), second);
  await page.getByRole('link', { name: 'View all uploads', exact: true }).click();
  assert.equal(await page.evaluate(() => window.uploadContinuityMarker), undefined, 'Reload created a new document earlier');
  await expect(page).toHaveURL(/\/uploads/);
  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.screenshot({ path: `outputs/upload-workflow-live/${engineName}-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${engineName}: real bytes, immediate pause, hidden details, client navigation, saved-source reload, lost completion receipt, offline recovery, deliberate pause, cancellation/publication race, responsive uploads page.`);
} finally { await browser.close(); }
