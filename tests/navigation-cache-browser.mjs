import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox, webkit, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8815';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const engineName = process.env.RELAY_CACHE_BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engineName]).launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const space = crypto.randomUUID(), albumA = crypto.randomUUID(), albumB = crypto.randomUUID(), sectionA = crypto.randomUUID(), sectionB = crypto.randomUUID();
const files = Array.from({ length: 40 }, (_, index) => ({ id: crypto.randomUUID(), name: `Photo-${index + 1}.jpg`, mime: 'image/jpeg', size: 50, sha256: 'a'.repeat(64), category: 'original', createdAt: Date.now() - index, deviceName: 'Fixture', hasPreview: true, revision: 0, sectionId: index < 20 ? sectionA : sectionB, sectionName: index < 20 ? 'First section' : 'Second section' }));
const thumbnailBytes = await readFile('prototypes/relay-polish/assets/chair.jpg');
const thumbnails = new Map(), errors = [];
async function expectDecodedImage(image) { await expect(image).toHaveAttribute('src', /^blob:/); await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0); }
let gateSection, releaseFeed, feedBlocked = false, forbidden = false, feedRequests = 0;
let gate = Promise.resolve();
page.on('pageerror', error => errors.push(error.message));
// Controlled responses prove repeat views render before revalidation, without confusing fixtures with live timing.
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  if (path === '/api/auth/spaces') return route.fulfill({ json: { spaces: [{ id: space, name: 'Cache studio', role: 'owner', kind: 'shared' }] } });
  if (path === '/api/session') return route.fulfill({ json: { authentication: 'account', personId: 'fixture', deviceId: 'fixture-device', role: 'owner', transport: 'local', space: { id: space, name: 'Cache studio', kind: 'shared' } } });
  if (path === '/api/feed') {
    feedRequests++;
    if (gateSection !== undefined && url.searchParams.get('section') === gateSection) { feedBlocked = true; await gate; }
    if (forbidden) return route.fulfill({ status: 403, json: { error: 'Library access revoked' } });
    const inB = url.searchParams.get('album') === albumB;
    const section = url.searchParams.get('section');
    const selected = (inB ? [files[20]] : files).filter(file => !section || file.sectionId === section);
    return route.fulfill({ json: { items: selected.map(file => ({ ...file, sectionId: inB ? null : file.sectionId, sectionName: inB ? null : file.sectionName })), total: selected.length, nextCursor: null, role: 'owner', counts: { all: 40, original: 40, final: 0, trash: 0 } } });
  }
  if (path === '/api/albums') return route.fulfill({ json: { albums: [{ id: albumA, name: 'Album A', count: 40, revision: 0, createdAt: Date.now() }, { id: albumB, name: 'Album B', count: 1, revision: 0, createdAt: Date.now() }], sections: [{ id: sectionA, albumId: albumA, name: 'First section', count: 20, position: 0 }, { id: sectionB, albumId: albumA, name: 'Second section', count: 20, position: 1 }] } });
  if (path === '/api/storage') return route.fulfill({ json: { used: 2000, reserved: 0, trash: 0, limit: 1000000, uploads: [] } });
  if (path === '/api/library/rename') {
    for (const update of route.request().postDataJSON().files) { const file = files.find(file => file.id === update.id); file.name = update.name; file.revision++; }
    return route.fulfill({ json: { changed: true } });
  }
  if (path.endsWith('/thumbnail')) {
    thumbnails.set(path, (thumbnails.get(path) || 0) + 1);
    return route.fulfill({ contentType: 'image/jpeg', body: thumbnailBytes });
  }
  if (path === '/api/activity') return route.fulfill({ json: { events: [], next: null } });
  throw new Error(`Unexpected fixture request: ${path}`);
});
const tabs = page.getByRole('group', { name: 'Album section', exact: true });
const thumbnailCount = index => thumbnails.get(`/api/media/${files[index].id}/thumbnail`) || 0;
try {
  await page.goto(`${origin}/?space=${space}&view=files&album=${albumA}&section=${sectionA}`);
  const firstImage = page.getByRole('img', { name: 'Photo-1.jpg', exact: true });
  await expectDecodedImage(firstImage);
  const originalSource = await firstImage.getAttribute('src');
  assert.ok(originalSource.startsWith('blob:'));
  await tabs.getByRole('button', { name: /Second section/ }).hover();
  await expect.poll(() => thumbnailCount(20)).toBe(1);
  assert.equal(thumbnailCount(26), 0, 'Intent warming stops after the first six thumbnails.');
  await tabs.getByRole('button', { name: /Second section/ }).click();
  await expectDecodedImage(page.getByRole('img', { name: 'Photo-21.jpg', exact: true }));
  gateSection = sectionA; gate = new Promise(resolve => { releaseFeed = resolve; });
  const started = Date.now();
  await tabs.getByRole('button', { name: /First section/ }).click();
  await expectDecodedImage(firstImage);
  const elapsed = Date.now() - started;
  await expect.poll(() => feedBlocked).toBe(true);
  await expect(page.getByText('Loading files...', { exact: true })).toHaveCount(0);
  assert.equal(await firstImage.getAttribute('src'), originalSource);
  assert.equal(thumbnailCount(0), 1, 'Repeat section reuses its thumbnail while its feed response is held.');
  gateSection = undefined; releaseFeed();
  await tabs.getByRole('button', { name: /Second section/ }).click();
  await expect(page.getByRole('heading', { name: 'Photo-21.jpg', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 600));
  const previousY = await page.evaluate(() => window.scrollY);
  assert.ok(previousY > 300);
  await page.locator('.sidebar').getByRole('button', { name: /^Album B/ }).click();
  await expect(page.locator('.media-card')).toHaveCount(1);
  await expectDecodedImage(page.getByRole('img', { name: 'Photo-21.jpg', exact: true }));
  assert.equal(thumbnailCount(20), 1, 'The same file in another album reuses its thumbnail.');
  await page.locator('.sidebar').getByRole('button', { name: /^Album A/ }).click();
  await expect(tabs.locator('[aria-pressed=true]')).toContainText('Second section');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(previousY);
  await page.locator('.media-card').filter({ has: page.getByRole('heading', { name: 'Photo-21.jpg', exact: true }) }).getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('Updated photo');
  await page.getByRole('button', { name: 'Apply rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated photo.jpg', exact: true })).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: /^Album B/ }).click();
  await expect(page.getByRole('heading', { name: 'Photo-21.jpg', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Updated photo.jpg', exact: true })).toBeVisible();
  forbidden = true;
  await page.locator('.sidebar').getByRole('button', { name: /^Album A/ }).click();
  await expect(page.locator('.media-card')).toHaveCount(0);
  await expect(page.getByText(/Library access revoked|Workspace unavailable|Couldn.t open/i).first()).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(`PASS ${engineName}: repeat section rendered in ${elapsed}ms with revalidation held; one thumbnail request per repeated/shared image; remembered section/scroll; rename invalidation; revoked-access clearing (${feedRequests} feed requests).`);
} catch(error) { await page.screenshot({path:'.sites-runtime/cache-failure.png'}); throw error; } finally { releaseFeed?.(); await browser.close(); }
