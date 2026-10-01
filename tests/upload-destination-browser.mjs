import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { chooseWorkspaceOption } from './browser-controls.mjs';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const spaces = [{ id: crypto.randomUUID(), name: 'Personal', kind: 'personal', actorId: crypto.randomUUID(), role: 'owner' }, { id: crypto.randomUUID(), name: 'Studio', kind: 'shared', actorId: crypto.randomUUID(), role: 'owner' }];
const account = { sessionId: crypto.randomUUID(), displayName: 'Upload fixture', verifiedEmail: 'fixture@example.test' };
const admissions = [];
const bodies = [];
let release;
const gate = new Promise(resolve => { release = resolve; });
let signedIn = true;
const errors = []; page.on('pageerror', error => errors.push(error.message));

// Controlled account fixtures verify immutable destination routing; real byte/authority tests run separately.
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  const selected = spaces.find(space => space.id === url.searchParams.get('space'));
  if (path === '/api/auth/spaces') return route.fulfill({ json: { spaces: signedIn ? spaces : [] } });
  if (path === '/api/auth/session') return route.fulfill({ json: { enabled: true, account: signedIn ? account : null } });
  if (path === '/api/auth/sessions') return route.fulfill({ json: { sessions: [], currentSessionId: account.sessionId } });
  if (path === '/api/auth/deletion') return route.fulfill({ json: { request: null, ownershipBlockers: [], recentSignIn: true } });
  if (path.startsWith('/api/auth/sessions/') && request.method() === 'DELETE') { signedIn = false; return route.fulfill({ json: { revoked: true, providerLogoutUrl: '/login' } }); }
  if (path === '/api/session') return route.fulfill({ status: selected && signedIn ? 200 : 401, json: { deviceId: selected?.actorId, authentication: 'account', personId: 'fixture-person', role: 'owner', transport: 'local', space: selected } });
  if (path === '/api/feed') return route.fulfill({ json: { items: [], total: 0, counts: { all: 0, original: 0, final: 0, trash: 0 }, role: 'owner' } });
  if (path === '/api/albums') return route.fulfill({ json: { albums: [], sections: [] } });
  if (path === '/api/storage') return route.fulfill({ json: { used: 0, reserved: 0, trash: 0, limit: 1e9, uploads: [] } });
  if (path === '/api/activity') return route.fulfill({ json: { events: [], next: null } });
  if (path === '/api/uploads') { admissions.push({ space: selected.id, ...request.postDataJSON() }); return route.fulfill({ json: { status: 'uploading', partSize: 16777216, uploadId: 'fixture-multipart' } }); }
  if (path.endsWith('/part')) return route.fulfill({ json: { url: `${origin}/api/uploads/${admissions[0].id}/bytes/1?space=${selected.id}` } });
  if (path.includes('/bytes/')) { bodies.push(request.postDataBuffer()); await gate; return route.fulfill({ headers: { ETag: 'part-one' }, body: '{}' }); }
  if (path.endsWith('/complete')) { assert.equal(selected.id, spaces[0].id); return route.fulfill({ json: { ready: true } }); }
  return route.fulfill({ status: 404, json: { error: 'No fixture record' } });
});
try {
  await page.goto(`${origin}/?space=${spaces[0].id}&view=files`);
  await expect(page.getByRole('button', { name: 'Add files', exact: true }).first()).toBeVisible();
  const original = Buffer.alloc(1024 * 1024, 82);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: 'destination.raw', mimeType: 'application/octet-stream', buffer: original });
  await expect.poll(() => bodies.length).toBe(1);
  await page.evaluate(() => { window.destinationContinuityMarker = true; });
  await chooseWorkspaceOption(page, 'Switch library', spaces[1].id);
  await expect(page).toHaveURL(new RegExp(spaces[1].id));
  assert.equal(await page.evaluate(() => window.destinationContinuityMarker), true);
  release();
  await expect(page.locator('.upload-indicator')).toHaveText('1 uploaded', { timeout: 30000 });
  assert.equal(admissions.length, 1); assert.equal(admissions[0].space, spaces[0].id);
  assert.deepEqual(bodies[0], original);
  await page.locator('.upload-indicator').click();
  await expect(page.locator('.upload-row')).toContainText('Personal');
  await page.getByRole('button', { name: 'Hide upload details' }).click();
  await page.getByRole('link', { name: 'Choose workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces/);
  assert.equal(await page.evaluate(() => window.destinationContinuityMarker), true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('.upload-indicator')).toHaveCount(0);
  const retained = await page.evaluate(async () => {
    const count = name => new Promise(resolve => { const request = indexedDB.open(name); request.onsuccess = () => { const db = request.result; const read = db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]).count(); read.onsuccess = () => { resolve(read.result); db.close(); }; }; });
    return Promise.all(['relay-transfers', 'relay-upload-sources'].map(count));
  });
  assert.deepEqual(retained, [0, 0]); assert.deepEqual(errors, []);
  console.log('PASS: workspace switch keeps document/files and original destination, account navigation, sign-out clears manifests and recovery sources.');
} finally { await browser.close(); }
