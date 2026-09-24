import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8795';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const space = crypto.randomUUID();
const owner = crypto.randomUUID();
const member = crypto.randomUUID();
const token = 'a'.repeat(64);
let mutations = 0;
let pairedCount = 2;
let disconnected = 0;
let acceptances = 0;
let signedIn = false;
let revision = 0;
const errors = [];
page.on('pageerror', error => errors.push(error.message));

// Mock identities only; exercise rendered forms, confirmation cancellation, fixed scope and invitation navigation.
try {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/legacy-devices') return route.fulfill({ json: { total: pairedCount, devices: pairedCount ? [
      { id: owner, name: 'Old laptop', role: 'owner', linkedPerson: 'Morgan Ellis' },
      { id: member, name: 'Shared tablet', role: 'member', linkedPerson: null }] : [] } });
    if (url.pathname.startsWith('/api/legacy-devices/')) {
      assert.equal(url.searchParams.get('space'), space);
      assert.deepEqual(route.request().postDataJSON(), { confirmed: true });
      disconnected++; pairedCount = 0; return route.fulfill({ json: { revoked: 2 } });
    }
    if (url.pathname === '/api/people') {
      assert.equal(url.searchParams.get('space'), space);
      return route.fulfill({ json: { space: { id: space, name: 'Family archive' }, currentMembershipId: owner, role: 'owner', legacyDevices: pairedCount,
        members: [{ id: owner, name: 'Morgan Ellis', email: 'morgan@example.test', role: 'owner', revision: 0 },
          { id: member, name: 'Sam Reed', email: 'sam@example.test', role: revision ? 'owner' : 'member', revision }], invitations: [] } });
    }
    if (url.pathname === '/api/people/' + member) {
      assert.equal(url.searchParams.get('space'), space); mutations++; revision++;
      return route.fulfill({ json: { changed: true } });
    }
    if (url.pathname === '/api/person-invitations') {
      assert.equal(url.searchParams.get('space'), space);
      assert.equal(route.request().postDataJSON().email, 'alex@example.test');
      assert.equal(route.request().postDataJSON().role,'contributor');
      return route.fulfill({ json: { token, email: 'alex@example.test',role:'contributor' } });
    }
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { enabled: true, account: signedIn ? { sessionId: owner, displayName: 'Alex', verifiedEmail: 'alex@example.test' } : null } });
    if (url.pathname === '/api/auth/sessions') return route.fulfill({ json: { sessions: [] } });
    if (url.pathname === '/api/auth/spaces') return route.fulfill({ json: { spaces: [] } });
    if (url.pathname === '/api/auth/login') {
      assert.equal(url.searchParams.get('session'), 'temporary'); signedIn = true;
      return route.fulfill({ status: 303, headers: { Location: `${origin}/account` } });
    }
    if (url.pathname === '/api/auth/invitation-preview') {
      assert.equal(route.request().headers()['x-relay-invitation'], token);
      return route.fulfill({ json: { spaceName: 'Family archive', email: 'alex@example.test', role:'contributor', expiresAt: Date.now() + 604800000 } });
    }
    if (url.pathname === '/api/auth/invitation-accept') {
      acceptances++; return route.fulfill({ json: { spaceId: space } });
    }
    return route.fulfill({ status: 401, json: { error: 'Fixture signed out.' } });
  });
  await page.goto(`${origin}/people?space=${space}`);
  await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
  await expect(page.getByText(/2 legacy paired devices/)).toBeVisible();
  await page.getByRole('button', { name: 'Review devices', exact: true }).click();
  await expect(page.getByText('Owner \u00b7 Claimed by Morgan Ellis', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Shared tablet', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('including native apps');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(disconnected, 0);
  await page.getByRole('combobox',{name:'Role for Sam Reed'}).click();
  await page.getByRole('option',{name:'Editor',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('cannot manage access or permanently delete');
  await expect(page.getByRole('dialog')).toContainText('Linked paired devices have Member access');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(mutations,0);
  await page.getByRole('combobox',{name:'Role for Sam Reed'}).click();
  await page.getByRole('option',{name:'Owner',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Make Sam Reed an owner?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(mutations, 0);
  await page.getByRole('combobox',{name:'Role for Sam Reed'}).click();
  await page.getByRole('option',{name:'Owner',exact:true}).click();
  await page.getByRole('button', { name: 'Change role', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Access updated');
  assert.equal(mutations, 1);
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.test');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(`${origin}/join#invite=${token}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('.sites-runtime/space-people', { recursive: true });
  await page.screenshot({ path: '.sites-runtime/space-people/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: '.sites-runtime/space-people/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'End all paired-device access', exact: true }).click();
  await page.getByRole('button', { name: 'End paired access', exact: true }).click();
  await expect(page.getByText('Only current library members have access through Relay.', { exact: true })).toBeVisible();
  assert.equal(disconnected, 1);
  await page.goto(`${origin}/join#invite=${token}`);
  await expect(page.getByText(/Sign in below with the email address/)).toBeVisible();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(acceptances, 0);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join Family archive?' })).toBeVisible();
  assert.equal(acceptances, 0, 'Returning from sign-in cannot silently accept an invitation');
  await page.getByRole('button', { name: 'Dismiss invitation' }).click();
  assert.equal(acceptances, 0);
  await page.goto(`${origin}/join#invite=${token}`);
  await expect(page.getByRole('heading', { name: 'Join Family archive?' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.sites-runtime/space-people/join-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Join library', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/?space=${space}`);
  assert.equal(acceptances, 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('relay-pending-person-invitation')), null);
  assert.deepEqual(errors, []);
  console.log('PASS: responsive people controls, role-change cancel/confirm, invitation scope, fragment removal, sign-in continuity and explicit join. Account responses are fixtures.');
} finally { await browser.close(); }
