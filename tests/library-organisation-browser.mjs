import assert from 'node:assert/strict';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8790';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Browser fixtures require isolated local storage.');
await mkdir('outputs/library', { recursive: true });

// Exercise complete user journeys against the built app, including actual uploads and renamed downloads.
async function verifyOrganisation(engine, options, label) {
  const browser = await engine.launch(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const bytes = Buffer.from('Original source bytes, preserved after organisation.');
  try {
    await page.goto(origin);
    await page.getByLabel('Space name').fill(`Studio library ${label}`);
    await page.getByRole('button', { name: 'Create shared space' }).click();
    await page.getByRole('button', { name: 'New album', exact: true }).click();
    await page.getByLabel('Album name', { exact: true }).fill('September product shoot');
    await page.getByLabel('Description', { exact: true }).fill('Originals and finished work from our September shoot.');
    await page.getByRole('button', { name: 'Create album', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'September product shoot.' })).toBeVisible();
    const albumId = await page.getByLabel('Browse library').inputValue();
    await page.getByLabel('Choose original files', { exact: true }).setInputFiles([
      { name: 'camera-one.raw', mimeType: 'application/octet-stream', buffer: bytes },
      { name: 'camera-two.raw', mimeType: 'application/octet-stream', buffer: bytes },
    ]);
    // Changing the view while transfers run must not change their persisted destination.
    await page.getByLabel('Browse library').selectOption('unorganised');
    await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('article')).toHaveCount(0);
    await page.getByLabel('Browse library').selectOption(albumId);
    await expect(page.locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Dismiss completed transfers' }).click();
    await page.locator('article').filter({ hasText: 'camera-one.raw' }).getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('File name', { exact: true }).fill('Product hero');
    await expect(page.getByRole('dialog')).toContainText('Product hero.raw');
    await page.getByRole('button', { name: 'Apply rename', exact: true }).click();
    await expect(page.locator('article h3').filter({ hasText: 'Product hero.raw' })).toBeVisible();
    await page.getByLabel('Search filenames').fill('camera-one');
    await expect(page.locator('article')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('article').getByRole('button', { name: 'Save to device' }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'Product hero.raw');
    assert.deepEqual(await readFile(await download.path()), bytes);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('article h3').filter({ hasText: 'camera-one.raw' })).toBeVisible();
    await page.getByRole('button', { name: 'Select loaded files (2)', exact: true }).click();
    await page.getByRole('button', { name: 'Rename selected', exact: true }).click();
    await page.getByLabel('Name prefix', { exact: true }).fill('September shoot');
    await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(2);
    await page.screenshot({ path: `outputs/library/${label}-rename.png`, fullPage: true });
    await page.getByRole('button', { name: 'Apply rename', exact: true }).click();
    await expect(page.locator('article h3').filter({ hasText: 'September shoot' })).toHaveCount(2);
    await page.getByRole('button', { name: 'New album', exact: true }).click();
    await page.getByLabel('Album name', { exact: true }).fill('Portfolio');
    await page.getByRole('button', { name: 'Create album', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio.' })).toBeVisible();
    const portfolioId = await page.getByLabel('Browse library').inputValue();
    await page.getByLabel('Browse library').selectOption(albumId);
    await expect(page.locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Select loaded files (2)', exact: true }).click();
    await page.getByLabel('Destination album', { exact: true }).selectOption(portfolioId);
    await page.getByRole('button', { name: 'Add to album', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 files added to album' })).toBeVisible();
    await page.getByLabel('Browse library').selectOption(portfolioId);
    await expect(page.locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Select loaded files (2)', exact: true }).click();
    await page.getByRole('button', { name: 'Remove from album', exact: true }).click();
    await expect(page.locator('article')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('article')).toHaveCount(2);
    await page.locator('article').first().getByRole('button', { name: /^Preview / }).click();
    await expect(page.getByRole('dialog')).toContainText('Uploaded name');
    await page.getByRole('button', { name: 'Correct capture date', exact: true }).click();
    await page.getByLabel('Date taken', { exact: true }).fill('2024-09-18T14:30');
    await page.getByRole('button', { name: 'Save capture date', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Dates', { exact: true }).selectOption('captured');
    await page.getByLabel('From', { exact: true }).fill('2024-09-18');
    await page.getByLabel('To', { exact: true }).fill('2024-09-18');
    await expect(page.locator('article')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.getByLabel('Browse library')).toHaveValue(portfolioId);
    await page.getByRole('button', { name: 'Clear date / batch filters', exact: true }).click();
    await expect(page.locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Manage album', exact: true }).click();
    await page.getByRole('button', { name: 'Archive album', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeEnabled();
    await page.locator('.sidebar').getByRole('button', { name: /^All files/ }).click();
    await expect(page.getByLabel('Browse library')).toHaveValue('');
    await page.goBack();
    await expect(page.getByLabel('Browse library')).toHaveValue(portfolioId);
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.screenshot({ path: `outputs/library/${label}-desktop.png`, fullPage: true });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: no horizontal overflow at ${width}px`);
      await expect(page.getByLabel('Browse library')).toBeVisible();
      if (width === 390) await page.screenshot({ path: `outputs/library/${label}-compact.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${label}: albums, captured upload destination, rename/undo, original-name search, renamed byte-identical download, bulk previews/renames/membership, capture dates, deep-link reload, archive/undo, responsive layouts.`);
  } finally { await browser.close(); }
}

if (process.env.CI) await verifyOrganisation(chromium, {}, 'chromium');
else {
  await verifyOrganisation(chromium, { channel: 'chrome' }, 'chrome');
  await verifyOrganisation(chromium, { channel: 'msedge' }, 'edge');
}
await verifyOrganisation(firefox, {}, 'firefox');
await verifyOrganisation(webkit, {}, 'webkit');
