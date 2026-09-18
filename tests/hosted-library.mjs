import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, firefox, expect } from '@playwright/test';

// Use only the existing isolated verification credential; never log it or any signed R2 URL.
const { origin, cookie } = JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8'));
assert.equal(origin, 'https://relay-media-exchange.kiwanukaphil.workers.dev');
const headers = { Origin: origin, Cookie: cookie };
const api = (path, method = 'GET', body) => fetch(`${origin}/api/${path}`, {
  method, headers: { ...headers, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
});
const sessionResponse = await api('session');
assert.equal(sessionResponse.status, 200);
const session = await sessionResponse.json();
assert.equal(session.space.name, 'Relay verification', 'Never change the real owner workspace in release checks.');
assert.equal(session.role, 'owner');
assert.equal(session.transport, 'direct');
const separator = cookie.indexOf('=');
const browserCookie = { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, secure: true, sameSite: 'Strict' };
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([browserCookie]);
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const suffix = randomUUID().slice(0, 8);
const albumName = `Library release check ${suffix}`;
const originalName = `camera-${suffix}.raw`;
const renamedStem = `Product hero ${suffix}`;
const bytes = Buffer.from(`Unmodified release-check original ${suffix}`);
await mkdir('outputs/library-release', { recursive: true });
try {
  await page.goto(origin);
  await page.getByRole('button', { name: 'New album', exact: true }).click();
  await page.getByLabel('Album name', { exact: true }).fill(albumName);
  await page.getByLabel('Description', { exact: true }).fill('Isolated production verification fixture. Retained for review.');
  await page.getByRole('button', { name: 'Create album', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${albumName}.` })).toBeVisible({ timeout: 15000 });
  const albumId = await page.getByLabel('Browse library').inputValue();
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: originalName, mimeType: 'application/octet-stream', buffer: bytes });
  const card = page.locator('article').filter({ hasText: originalName });
  await expect(card).toBeVisible({ timeout: 60000 });
  await card.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill(renamedStem);
  await expect(page.getByRole('dialog')).toContainText(`${renamedStem}.raw`);
  await page.getByRole('button', { name: 'Apply rename', exact: true }).click();
  await expect(page.locator('article h3')).toHaveText(`${renamedStem}.raw`, { timeout: 15000 });
  await page.getByLabel('Search filenames').fill(originalName);
  await expect(page.locator('article')).toHaveCount(1);
  const feedResponse = await api(`feed?album=${albumId}&q=${encodeURIComponent(originalName)}`);
  assert.equal(feedResponse.status, 200);
  const item = (await feedResponse.json()).items[0];
  assert.equal(item.originalName, originalName); assert.equal(item.name, `${renamedStem}.raw`);
  assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'));
  const captureResponse = await api('library/capture-date', 'POST', { id: item.id, capturedAt: '2026-09-17T23:30:00', expectedRevision: item.revision });
  assert.equal(captureResponse.status, 200);
  const capturedFeed = await api(`feed?album=${albumId}&dateMode=captured&from=2026-09-17&to=2026-09-17`);
  assert.equal((await capturedFeed.json()).items[0].id, item.id);
  await page.reload();
  await expect(page.getByLabel('Browse library')).toHaveValue(albumId);
  await expect(page.locator('article h3')).toHaveText(`${renamedStem}.raw`);
  await page.screenshot({ path: 'outputs/library-release/hosted-library.png', fullPage: true });
  const fallbackBrowser = await firefox.launch();
  try {
    const fallback = await fallbackBrowser.newContext({ acceptDownloads: true });
    await fallback.addCookies([browserCookie]);
    const receiver = await fallback.newPage();
    await receiver.goto(`${origin}/?album=${albumId}`);
    await expect(receiver.locator('article h3')).toHaveText(`${renamedStem}.raw`, { timeout: 15000 });
    const pending = receiver.waitForEvent('download');
    await receiver.locator('article').getByRole('button', { name: 'Save to device' }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), `${renamedStem}.raw`);
    assert.deepEqual(await readFile(await download.path()), bytes);
  } finally { await fallbackBrowser.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS hosted library: album creation, direct-to-album R2 upload, rename preview/application, uploaded-name search, capture-date correction/filtering, deep-link reload, Firefox renamed download with exact original bytes.');
  // Removal candidate: this uniquely named verification album/file is retained rather than deleted automatically.
  console.log('The small named fixture is retained only in Relay verification.');
} finally { await browser.close(); }
