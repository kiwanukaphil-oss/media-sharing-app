import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Browser access tests must stay local.');
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const ownerContext = await browser.newContext();
const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const owner = await ownerContext.newPage();
const member = await memberContext.newPage();
const errors = [];
owner.on('pageerror', error => errors.push(error.message));
member.on('pageerror', error => errors.push(error.message));
owner.on('dialog', dialog => dialog.accept());
member.on('dialog', dialog => dialog.accept());

// Two isolated browsers exercise the actual invitation, owner controls and sign-out cookie lifecycle.
try {
  await owner.goto(origin);
  await owner.getByRole('button', { name: 'Create shared space' }).click();
  await expect(owner.getByLabel('Search filenames')).toBeVisible();
  await owner.getByRole('button', { name: 'Pair a device', exact: true }).click();
  const ownerDialog = owner.getByRole('dialog', { name: 'Your connected devices' });
  await expect(ownerDialog.getByRole('button', { name: 'Disconnect this device', exact: true })).toBeDisabled();
  await ownerDialog.getByRole('button', { name: 'Pair a device', exact: true }).click();
  const invitation = await ownerDialog.getByLabel('Invitation link').inputValue();
  await member.goto(invitation);
  await member.getByLabel('This device', { exact: true }).fill('Member browser fixture');
  await member.getByRole('button', { name: 'Join shared space' }).click();
  await expect(member.getByLabel('Search filenames')).toBeVisible();
  await member.getByRole('button', { name: 'Devices', exact: true }).click();
  const memberDialog = member.getByRole('dialog', { name: 'Your connected devices' });
  await expect(memberDialog).toContainText('You are a member');
  await expect(memberDialog.getByRole('button', { name: 'Pair a device', exact: true })).toHaveCount(0);
  await expect(memberDialog.getByRole('button', { name: 'Make owner', exact: true })).toHaveCount(0);
  await member.keyboard.press('Escape');
  await member.getByLabel('Choose original files', { exact: true }).setInputFiles({
    name: 'member-original.raw', mimeType: 'application/octet-stream', buffer: Buffer.from('Member original bytes'),
  });
  await expect(member.locator('article').filter({ hasText: 'member-original.raw' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0);
  await owner.keyboard.press('Escape');
  await owner.getByRole('button', { name: /Connected devices/ }).click();
  const memberRow = ownerDialog.locator('.device-row').filter({ hasText: 'Member browser fixture' });
  await memberRow.getByRole('button', { name: 'Make owner', exact: true }).click();
  await owner.locator('.action-confirmation').getByRole('button', { name: 'Make owner', exact: true }).click();
  await expect(memberRow.getByRole('button', { name: 'Make member', exact: true })).toBeVisible();
  await expect(ownerDialog.getByRole('button', { name: 'Disconnect this device', exact: true })).toBeEnabled();
  await member.reload();
  await expect(member.getByRole('button', { name: 'Move to Trash', exact: true })).toBeVisible();
  await member.getByRole('button', { name: 'Pair a device', exact: true }).click();
  await expect(memberDialog).toContainText('You are an owner');
  const oldCookie = (await memberContext.cookies()).find(cookie => cookie.name === 'relay_device');
  await memberDialog.getByRole('button', { name: 'Disconnect this device', exact: true }).click();
  await member.locator('.action-confirmation').getByRole('button', { name: 'Disconnect this device', exact: true }).click();
  await expect(member.getByRole('button', { name: 'Create shared space', exact: true })).toBeVisible();
  assert.equal((await memberContext.cookies()).some(cookie => cookie.name === 'relay_device'), false);
  const revoked = await ownerContext.request.get(`${origin}/api/feed`, { headers: { Cookie: `relay_device=${oldCookie.value}` } });
  assert.equal(revoked.status(), 401);
  await member.reload();
  await expect(member.getByRole('button', { name: 'Create shared space', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: responsive member controls, owner promotion, named dialogs, last-owner guidance, self-disconnection and persistent cookie revocation.');
} finally { await browser.close(); }
