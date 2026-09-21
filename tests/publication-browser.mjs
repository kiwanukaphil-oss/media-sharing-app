import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8795';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const personal = crypto.randomUUID(), shared = crypto.randomUUID(), album = crypto.randomUUID(), section = crypto.randomUUID();
const item = { id: crypto.randomUUID(), name: 'Private original.jpg', mime: 'image/jpeg', size: 1024, sha256: 'a'.repeat(64), category: 'original', createdAt: Date.now(), deviceName: 'Publisher', hasPreview: true, revision: 3 };
let pending = null;
let copies = 0;
const errors = [];
page.on('pageerror', error => errors.push(error.message));

// UI fixtures verify deliberate audience consent and idempotent recovery; R2 bytes are tested separately.
try {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/spaces') return route.fulfill({ json: { spaces: [{ id: personal, name: 'My space', kind: 'personal' }, { id: shared, name: 'Family archive', kind: 'shared' }] } });
    assert.equal(url.searchParams.get('space'), ['/api/albums', '/api/sections'].includes(url.pathname) && url.searchParams.get('space') === shared ? shared : personal);
    if (url.pathname === '/api/session') return route.fulfill({ json: { authentication: 'account', personId: 'fixture', deviceId: 'fixture-actor', role: 'owner', transport: 'local', space: { id: personal, name: 'My space', kind: 'personal' } } });
    if (url.pathname === '/api/feed') return route.fulfill({ json: { items: [item], total: 1, nextCursor: null, role: 'owner', counts: { all: 1, original: 1, final: 0, trash: 0 } } });
    if (url.pathname === '/api/storage') return route.fulfill({ json: { used: 1024, reserved: 0, trash: 0, limit: 1073741824, uploads: [] } });
    if (url.pathname === '/api/albums') return route.fulfill({ json: { albums: url.searchParams.get('space') === shared ? [{ id: album, name: 'Summer', archivedAt: null, deletedAt: null }] : [], sections: [] } });
    if (url.pathname === '/api/sections') {
      assert.equal(url.searchParams.get('album'), album);
      return route.fulfill({ json: { sections: [{ id: section, name: 'Selected', albumId: album }] } });
    }
    if (url.pathname === '/api/publications') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { publication: pending } });
      const input = route.request().postDataJSON();
      assert.equal(input.confirmed, true); assert.equal(input.sourceId, item.id); assert.equal(input.sourceRevision, 3);
      assert.equal(input.destinationSpaceId, shared); assert.equal(input.albumId, album); assert.equal(input.sectionId, section);
      copies++;
      if (!pending) { pending = { ...input, phase: 'pending' }; return route.fulfill({ status: 503, json: { error: 'The copy could not be verified. Retry or cancel.' } }); }
      assert.equal(input.id, pending.id, 'Retry must reuse the stored operation'); pending.phase = 'ready';
      return route.fulfill({ json: { published: true, id: input.id, destinationSpaceId: shared } });
    }
    if (/\/media\/.*\/(thumbnail|preview)$/.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=', 'base64') });
    throw new Error('Unexpected publication UI route: ' + url.pathname);
  });
  const openPublication = async () => {
    await page.getByRole('button', { name: `Preview ${item.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Publish shared copy', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Publish a shared copy', exact: true })).toBeVisible();
  };
  await page.goto(`${origin}/?space=${personal}`);
  await openPublication();
  await expect(page.getByText('Who can see this copy', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(copies, 0);
  await openPublication();
  await page.getByRole('combobox', { name: 'Destination album' }).click();
  await page.getByRole('option', { name: 'Summer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Destination section' }).click();
  await page.getByRole('option', { name: 'Selected', exact: true }).click();
  await mkdir('.sites-runtime/publication', { recursive: true });
  await page.screenshot({ path: '.sites-runtime/publication/mobile.png', fullPage: true });
  assert.equal(copies, 0, 'Destination selection cannot publish');
  await page.getByRole('button', { name: 'Publish copy', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await page.getByRole('button', { name: 'Close publication', exact: true }).click();
  await page.reload();
  await openPublication();
  await expect(page.getByRole('combobox', { name: 'Shared destination' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry publication' }).click();
  await expect(page.getByRole('heading', { name: 'Copy published' })).toBeVisible();
  assert.equal(copies, 2);
  await expect(page.getByRole('link', { name: 'Open shared library' })).toHaveAttribute('href', `/?space=${shared}&album=${album}&section=${section}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.sites-runtime/publication/desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: explicit publication consent, album/section destination, cancellation before publication, failed-copy recovery after reload and stable operation identity. UI responses are fixtures.');
} finally { await browser.close(); }
