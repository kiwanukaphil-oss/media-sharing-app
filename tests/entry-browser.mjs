import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, firefox, webkit, expect } from '@playwright/test';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8812';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const engine = process.env.RELAY_ENTRY_BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const account = { sessionId: 'fixture-session', displayName: 'Alex Morgan', verifiedEmail: 'alex@example.test' };
let signedIn = false, failed = false, spacesFailed = false, expired = false;
let spaces = [{ id: 'personal', name: 'My space', kind: 'personal', role: 'owner' }, { id: 'shared', name: 'Studio archive', kind: 'shared', role: 'editor' }];
let mediaReads = 0, signInMode;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// No real credentials: the provider handoff is simulated while the built routing and entry UI are exercised.
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname;
  if (path === '/api/auth/session') return route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Temporary interruption' } : { enabled: true, account: signedIn ? account : null } });
  if (path === '/api/auth/login') { signInMode = url.searchParams.get('session'); signedIn = true; return route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/workspaces")</script>' }); }
  if (path === '/api/auth/spaces') return route.fulfill({ status: spacesFailed ? 503 : expired ? 401 : 200, json: spacesFailed || expired ? { error: 'Unavailable' } : { spaces, personalSpace: { enabled: false } } });
  if (path === '/api/session') return route.fulfill({ status: signedIn && url.searchParams.has('space') ? 200 : 401, json: { authentication: 'account', deviceId: 'actor', role: 'owner', transport: 'local', space: { id: url.searchParams.get('space'), name: url.searchParams.get('space') === 'personal' ? 'My space' : 'Studio archive', kind: 'shared' } } });
  if (path === '/api/feed') { mediaReads++; return route.fulfill({ json: { items: [], total: 0, counts: { all: 0, trash: 0 }, role: 'owner' } }); }
  if (path === '/api/albums') return route.fulfill({ json: { albums: [], sections: [] } });
  if (path === '/api/storage') return route.fulfill({ json: { used: 0, reserved: 0, trash: 0, limit: 100000, uploads: [] } });
  if (path === '/api/activity') return route.fulfill({ json: { events: [], next: null } });
  if (path === '/api/auth/sessions') return route.fulfill({ json: { sessions: [] } });
  if (path === '/api/auth/deletion') return route.fulfill({ json: { request: null, ownershipBlockers: [], recentSignIn: true } });
  if (path === '/api/auth/invitation-preview') return route.fulfill({ json: { spaceName: 'Invited archive', email: account.verifiedEmail, expiresAt: Date.now() + 100000, role: 'viewer' } });
  if (path === '/api/auth/sessions/fixture-session') { signedIn = false; return route.fulfill({ json: { revoked: true } }); }
  throw new Error(`Unexpected entry request: ${path}`);
});
try {
  await mkdir('outputs/entry', { recursive: true });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Welcome to Relay.' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/api/auth/login?session=temporary');
  assert.equal(mediaReads, 0);
  await page.screenshot({ path: `outputs/entry/${engine}-signin.png`, fullPage: true });
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `outputs/entry/${engine}-signin-mobile.png`, fullPage: true });
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where would you like to begin?' })).toBeVisible();
  assert.equal(signInMode, 'temporary');
  assert.equal(mediaReads, 0, 'No file feed is loaded before workspace choice');
  await expect(page.getByRole('link', { name: 'Open workspace My space' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open workspace Studio archive' })).toBeVisible();
  await page.screenshot({ path: `outputs/entry/${engine}-workspaces-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `outputs/entry/${engine}-workspaces.png`, fullPage: true });
  await page.getByRole('link', { name: 'Open workspace Studio archive' }).click();
  await expect(page.getByRole('heading', { name: 'A home for every story.' })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('space'), 'shared');
  await page.getByRole('link', { name: 'Choose workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where would you like to begin?' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Relay.' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Keep me signed in/ }).check();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/api/auth/login?session=trusted');
  await page.goto(`${origin}/login?signin=verify-email`);
  await expect(page.getByRole('alert')).toContainText('Verify your email');
  failed = true; await page.reload();
  await expect(page.getByRole('heading', { name: "We couldn't open Relay." })).toBeVisible();
  failed = false; await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Relay.' })).toBeVisible();
  signedIn = true; spacesFailed = true; await page.goto(`${origin}/workspaces`);
  await expect(page.getByRole('button', { name: 'Retry workspaces' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No workspaces yet.' })).toHaveCount(0);
  spacesFailed = false; await page.getByRole('button', { name: 'Retry workspaces' }).click();
  await expect(page.getByRole('link', { name: 'Open workspace My space' })).toBeVisible();
  spaces = [spaces[0]]; await page.reload();
  await expect(page.getByRole('link', { name: 'Open workspace My space' })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, '/workspaces', 'One workspace still requires explicit choice');
  spaces = []; await page.reload();
  await expect(page.getByRole('heading', { name: 'No workspaces yet.' })).toBeVisible();
  expired = true; await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to Relay.' })).toBeVisible();
  expired = false;
  await page.evaluate(() => sessionStorage.setItem('relay-pending-person-invitation', 'a'.repeat(64)));
  await page.goto(`${origin}/workspaces`);
  await expect(page.getByRole('heading', { name: 'Join Invited archive?' })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, '/account');
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: fresh sign-in, temporary/trusted handoff, explicit workspace gate, album arrival, sign-out, errors/retry, zero/one workspaces, expiry, invitation handoff and responsive layout.`);
} finally { await browser.close(); }
