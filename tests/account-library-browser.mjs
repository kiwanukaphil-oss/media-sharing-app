import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8795';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const space = crypto.randomUUID();
const otherSpace = crypto.randomUUID();
const actor = crypto.randomUUID();
const item = { id: crypto.randomUUID(), name: 'Library original.jpg', mime: 'image/jpeg', size: 4,
  sha256: 'a'.repeat(64), category: 'original', createdAt: Date.now(), deviceName: 'Account owner', hasPreview: true, revision: 0 };
const requests = [];
const errors = [];
let forbidden = false;
let commonOwner = true;
let activeSpace = space;
let uploadCompleted = false;
let cancelledDestination = null;
page.on('pageerror', error => errors.push(error.message));
// UI fixtures isolate scope propagation; real membership and byte checks run in account-space-access.
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  requests.push(url);
  if (url.pathname === '/api/auth/spaces') return route.fulfill({ json: { spaces: [{ id: space, name: 'Family archive', role: 'owner', kind: 'shared', actorId: actor }, { id: otherSpace, name: 'My space', role: 'owner', kind: 'personal', actorId: 'other-actor' }] } });
  assert.equal(url.searchParams.get('space'), url.pathname.startsWith('/api/uploads') ? space : activeSpace, url.pathname + ' must retain its library');
  if (url.pathname.startsWith('/api/uploads/') && route.request().method() === 'DELETE') {
    cancelledDestination = url.searchParams.get('space');
    return route.fulfill({ json: { cancelled: true } });
  }
  if (url.pathname === '/api/session') return route.fulfill({ json: { authentication: 'account', personId: 'fixture',
    deviceId: actor, role: 'owner', transport: 'local', space: { id: activeSpace, name: activeSpace === space ? 'Family archive' : 'My space', kind: activeSpace === space ? 'shared' : 'personal' } } });
  if (forbidden) return route.fulfill({ status: 403, json: { error: 'This library is not available to your account.' } });
  if (url.pathname === '/api/feed') return route.fulfill({ json: { items: [item], total: 1, nextCursor: null, role: 'owner', counts: { all: 1, original: 1, final: 0, trash: 0 } } });
  if (url.pathname === '/api/albums') return route.fulfill({ json: { albums: [], sections: [] } });
  if (url.pathname === '/api/storage') return route.fulfill({ json: { used: 4, reserved: 0, trash: 0, limit: 100 * 1024 ** 3, pooled: true, ...(commonOwner ? { poolUsed: 30 * 1024 ** 3 } : {}), uploads: [] } });
  if (url.pathname === '/api/uploads') return route.fulfill({ json: { id: route.request().postDataJSON().id, status: 'uploading', partSize: 16777216, uploadId: 'fixture-upload' } });
  if (/\/uploads\/.*\/part$/.test(url.pathname)) return route.fulfill({ json: { url: `/api/uploads/fixture/bytes/1?space=${activeSpace}` } });
  if (url.pathname.endsWith('/bytes/1')) return route.fulfill({ headers: { ETag: 'fixture-etag' }, body: '{}' });
  if (url.pathname.endsWith('/complete')) { uploadCompleted = true; return route.fulfill({ json: { ready: true } }); }
  if (/\/media\/.*\/(thumbnail|preview)$/.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=', 'base64') });
  if(url.pathname==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  throw new Error('Unexpected route: ' + url.pathname);
});
try {
  await page.goto(`${origin}/?space=${space}&view=files`);
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair a device' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connected devices' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Storage/ }).click();
  await expect(page.getByRole('heading', { name: 'Your combined storage' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Combined storage used' })).toHaveAttribute('value', String(30 * 1024 ** 3));
  await expect(page.getByText('30.0 GB of 100.0 GB used across your personal and shared spaces.', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  commonOwner = false;
  await page.getByRole('button', { name: /^Storage/ }).click();
  await expect(page.getByRole('progressbar', { name: 'This library storage used' })).toHaveAttribute('value', '4');
  await expect(page.getByRole('progressbar', { name: 'Combined storage used' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: 'Search filenames' }).fill('original');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('original');
  assert.equal(new URL(page.url()).searchParams.get('space'), space);
  await page.getByRole('button', { name: `Preview ${item.name}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  assert.ok(requests.some(url => url.pathname.endsWith('/thumbnail')));
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'Scoped upload.txt', mimeType: 'text/plain', buffer: Buffer.from('Preserve this destination') });
  await expect.poll(() => uploadCompleted).toBe(true);
  await mkdir('.sites-runtime/account-library', { recursive: true });
  await page.screenshot({ path: '.sites-runtime/account-library/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: '.sites-runtime/account-library/mobile.png', fullPage: true });
  // Persist two accounts' manifests in the same browser; only current memberships may restore names.
  await page.evaluate(async ({ space, actor }) => {
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open('relay-transfers', 1);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('transfers', 'readwrite');
        const transfer = { id: crypto.randomUUID(), deviceId: actor, accountSpaceId: space, spaceName: 'Family archive',
          name: 'Queued family.txt', size: 12, mime: 'text/plain', category: 'original', state: 'paused', parts: [], progress: 0 };
        transaction.objectStore('transfers').put(transfer);
        transaction.objectStore('transfers').put({ ...transfer, id: crypto.randomUUID(), deviceId: 'foreign-person-actor', name: 'Other person private.txt' });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      opening.onerror = () => reject(opening.error);
    });
  }, { space, actor });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('combobox', { name: 'Switch library' }).click();
  activeSpace = otherSpace;
  await page.getByRole('option', { name: 'My space', exact: true }).click();
  await page.waitForURL(`**/?space=${otherSpace}`);
  await expect(page.getByRole('searchbox', { name: 'Search albums' })).toHaveValue('');
  await expect(page.getByTitle('My space', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A home for every story.', exact: true })).toBeVisible();
  await expect(page.getByText('Queued family.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('Other person private.txt', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open destination' })).toHaveAttribute('href', `/?space=${space}`);
  await page.screenshot({ path: '.sites-runtime/account-library/personal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel Queued family.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect.poll(() => cancelledDestination).toBe(space);
  await expect(page.getByText('Queued family.txt', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.library-utilities > summary').click();
  await page.locator('.sidebar').getByRole('button', { name: /^All files/ }).click();
  await expect(page.getByRole('searchbox', { name: 'Search filenames' })).toBeVisible();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  forbidden = true;
  await page.getByRole('searchbox', { name: 'Search filenames' }).fill('revoked');
  await expect(page.getByRole('link', { name: 'Sign in or choose a library' })).toBeVisible();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: account library UI scopes reads/previews/filter URLs, separates account controls, resets navigation and clears revoked content.');
} finally { await browser.close(); }
