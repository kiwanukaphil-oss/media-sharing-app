import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8795';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Account UI fixtures must stay local.');
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const currentId = crypto.randomUUID();
const otherId = crypto.randomUUID();
let signedIn = true;
let rejectRevocation = true;
let libraryConnected = false;
let claimConfirmations = 0;
let entries = [currentId, otherId].map(id => ({ id, createdAt: Date.now(), expiresAt: Date.now() + 604800000 }));

// First verify the real disabled endpoint, then isolate responsive UI states from the identity provider.
try {
  await page.goto(`${origin}/account`);
  await expect(page.getByRole('heading', { name: 'Account sign-in is coming soon' })).toBeVisible();
  assert.equal((await page.request.get(`${origin}/api/auth/login`)).status(), 404);
  await page.route('**/api/auth/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { enabled: true, account: signedIn ? {
      sessionId: currentId, displayName: 'Morgan Ellis', verifiedEmail: 'morgan@example.test', expiresAt: Date.now() + 604800000,
    } : null } });
    if (url.pathname === '/api/auth/sessions') return route.fulfill({ json: { currentSessionId: currentId, sessions: entries } });
    if (url.pathname === '/api/auth/spaces') return route.fulfill({ json: { spaces: libraryConnected ? [{ id: 'library', name: 'Family archive', role: 'owner' }] : [], personalSpace: { enabled: true, quotaBytes: 1073741824 } } });
    if (url.pathname === '/api/auth/personal-space') return route.fulfill({ status: 409, json: { error: 'My space is not available right now. Your existing libraries are unchanged.' } });
    if (url.pathname === '/api/auth/owner-claim') return route.fulfill({ json: {
      token: 'c'.repeat(64), spaceName: 'Family archive', deviceName: 'My desktop', accountEmail: 'morgan@example.test', expiresAt: Date.now() + 300000,
    } });
    if (url.pathname === '/api/auth/owner-claim/confirm') {
      assert.equal(route.request().headers()['x-relay-claim'], 'c'.repeat(64));
      claimConfirmations++; libraryConnected = true;
      return route.fulfill({ json: { connected: true } });
    }
    if (route.request().method() === 'DELETE') {
      if (rejectRevocation) return route.fulfill({ status: 503, json: { error: 'Sign-out is temporarily unavailable. Please retry.' } });
      const id = url.pathname.split('/').at(-1);
      entries = entries.filter(entry => entry.id !== id);
      if (id === currentId) signedIn = false;
      return route.fulfill({ json: { revoked: true } });
    }
    return route.abort();
  });
  await page.reload();
  await expect(page.getByText('morgan@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Another browser', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create My space' }).click();
  await expect(page.getByRole('alert')).toContainText('existing libraries are unchanged');
  await expect(page.getByRole('button', { name: 'Create My space' })).toBeEnabled();
  await page.getByRole('button', { name: 'Connect an existing library' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Family archive?' })).toBeVisible();
  await expect(page.getByText(/will become an owner/)).toContainText('morgan@example.test');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(claimConfirmations, 0, 'Cancel cannot mutate membership');
  await page.getByRole('button', { name: 'Connect an existing library' }).click();
  await page.screenshot({ path: '.sites-runtime/account-claim-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirm connection' }).click();
  await expect(page.getByRole('status')).toContainText('Library connected');
  await expect(page.getByText('Family archive', { exact: true })).toBeVisible();
  assert.equal(claimConfirmations, 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mkdir('.sites-runtime/account-preview', { recursive: true });
  await page.screenshot({ path: '.sites-runtime/account-preview/mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Sign out browser signed in/ }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByText('Another browser', { exact: true })).toBeVisible();
  rejectRevocation = false;
  await page.getByRole('button', { name: /Sign out browser signed in/ }).click();
  await expect(page.getByText('Another browser', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.sites-runtime/account-preview/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out this browser', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in securely' })).toBeVisible();
  await page.keyboard.press('Tab');
  assert.deepEqual(errors, []);
  console.log('PASS: disabled production routes, responsive account UI, explicit claim preview/cancel/confirm, failed revocation recovery, remote sign-out and current-browser sign-out. UI account data was mocked.');
} finally { await browser.close(); }
