import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { chooseWorkspaceOption } from './browser-controls.mjs';

// Only use the established verification space; never log its credential or direct-storage URLs.
const { origin: credentialOrigin, cookie } = JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8'));
assert.equal(credentialOrigin, 'https://relay-media-exchange.kiwanukaphil.workers.dev');
const origin = process.env.RELAY_HOSTED_ORIGIN || credentialOrigin;
assert.ok(['https://relayalbums.com', credentialOrigin].includes(origin), 'Credentials may only reach verified Relay production domains.');
const api = (path, method = 'GET', body) => fetch(`${origin}/api/${path}`, { method,
  headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
const session = await (await api('session')).json();
assert.equal(session.space.name, 'Relay verification'); assert.equal(session.role, 'owner');
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
// Exercise browser-managed download; the OS save picker is covered separately by the verified-save suite.
await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const albumName = `Sections verification ${randomUUID().slice(0, 8)}`;
const filename = `section-original-${randomUUID().slice(0, 8)}.raw`;
const bytes = Buffer.from('Relay section release: original bytes and metadata are preserved.');
try {
  await page.goto(origin);
  await page.getByRole('button', { name: 'New album', exact: true }).click();
  await page.getByLabel('Album name', { exact: true }).fill(albumName);
  await page.getByRole('button', { name: 'Create album', exact: true }).click();
  await page.getByRole('button', { name: 'New section', exact: true }).click();
  await page.getByLabel('Section name', { exact: true }).fill('A finished selection');
  await page.getByRole('button', { name: 'Create section', exact: true }).click();
  const sectionControl = page.getByRole('combobox', { name: 'Album section', exact: true });
  await expect(sectionControl).toContainText('A finished selection');
  const sectionId = await sectionControl.getAttribute('data-value');
  const albumId = await page.getByLabel('Browse library').getAttribute('data-value');
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes });
  await chooseWorkspaceOption(page, 'Album section', '');
  await expect(page.getByRole('heading', { name: filename, exact: true })).toBeVisible({ timeout: 60000 });
  await chooseWorkspaceOption(page, 'Album section', sectionId);
  await expect(page.getByRole('heading', { name: filename, exact: true })).toBeVisible();
  const item = (await (await api(`feed?album=${albumId}&section=${sectionId}`)).json()).items[0];
  assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'));
  await page.getByRole('checkbox', { name: `Select ${filename}`, exact: true }).click();
  await page.getByRole('button', { name: 'Move to section', exact: true }).click();
  await page.getByRole('button', { name: 'Move files', exact: true }).click();
  await expect(page.getByRole('heading', { name: filename, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: filename, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage section', exact: true }).click();
  await page.getByRole('button', { name: 'Remove section', exact: true }).click();
  await expect(sectionControl).toContainText('Unsectioned');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await chooseWorkspaceOption(page, 'Album section', sectionId);
  await page.reload();
  await expect(sectionControl).toHaveAttribute('data-value', sectionId);
  const downloading = page.waitForEvent('download');
  await page.locator('article').getByRole('button', { name: 'Save to device', exact: true }).click();
  const download = await downloading;
  assert.deepEqual(await readFile(await download.path()), bytes);
  await mkdir('outputs/sections', { recursive: true });
  await page.screenshot({ path: 'outputs/sections/hosted.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile('.sites-runtime/sections-release/hosted-verification.json', JSON.stringify({ result: 'passed', origin, albumId, sectionId, mediaId: item.id, sha256: item.sha256, originalBytes: bytes.length }, null, 2));
  console.log('PASS hosted sections: create, captured R2 upload destination, move/Undo, section remove/restore, deep link and byte-identical download.');
  // Removal candidate: retain this tiny verification fixture for review rather than auto-deleting it.
  console.log('Only a newly created fixture in Relay verification was modified; it remains for review.');
} finally { await browser.close(); }
