import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit, expect } from '@playwright/test';

const target = pathToFileURL(resolve('prototypes/relay-upload-workflow/index.html')).href;
const screenshots = resolve('outputs/upload-workflow');
await mkdir(screenshots, { recursive: true });

// Exercise the workflow using visible controls; no app server or real media is involved.
async function verifyWorkflow(engine, name) {
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(target);
    await page.getByRole('button', { name: /Coast weekend.*48 files/ }).click();
    await page.getByRole('button', { name: 'Add sample files' }).click();
    await expect(page.locator('#upload-panel')).toBeHidden();
    await expect(page.locator('#status-label')).toHaveText('0 of 3');
    await page.locator('#upload-status').click();
    await expect(page.locator('#upload-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    await expect(page.getByText('Paused by you', { exact: false })).toHaveCount(3);
    await page.getByRole('button', { name: 'Resume paused', exact: true }).click();
    await page.getByRole('button', { name: 'Hide upload details' }).click();
    await expect(page.locator('#upload-panel')).toBeHidden();
    await expect(page.locator('#upload-status')).toBeFocused();
    await page.locator('#workspace').selectOption('Studio');
    await page.locator('nav [data-page="Account"]').click();
    await page.getByRole('button', { name: 'Advance demo' }).click();
    await page.locator('nav [data-page="Uploads"]').click();
    await expect(page.locator('.destination')).toHaveText(Array(3).fill('Personal / Coast weekend'));
    await expect(page.locator('progress[aria-label="Total uploaded bytes"]')).toHaveAttribute('value', '800');
    await page.locator('#scenario').selectOption('returned');
    await expect(page.locator('#upload-panel')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Albums', exact: true })).toBeVisible();
    await page.locator('#upload-status').click();
    await expect(page.getByText('Paused by you', { exact: false })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#upload-panel')).toBeHidden();
    for (const [scenario, action] of [['offline', 'Restore connection (demo)'], ['access', 'Allow file access (demo)'], ['missing', 'Locate originals (demo)'], ['mixed', 'Resolve storage (demo)']]) {
      await page.locator('#scenario').selectOption(scenario);
      await expect(page.locator('#upload-panel')).toBeHidden();
      await page.locator('#upload-status').click();
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause all', exact: true })).toBeVisible();
    }
    await page.locator('#scenario').selectOption('missing');
    await page.locator('#upload-status').click();
    await page.screenshot({ path: resolve(screenshots, `${name}-recovery-desktop.png`), fullPage: true });
    await page.getByRole('button', { name: 'Cancel unfinished', exact: true }).click();
    await page.locator('.cancel-review').getByRole('button', { name: 'Cancel unfinished', exact: true }).click();
    await expect(page.locator('.upload-row')).toHaveCount(1);
    await expect(page.locator('.upload-row')).toContainText('Uploaded');
    await page.getByRole('button', { name: 'Clear history', exact: true }).click();
    await expect(page.getByText('You’re all caught up', { exact: true })).toBeVisible();
    await page.locator('#scenario').selectOption('fresh');
    await page.getByRole('button', { name: /Coast weekend.*48 files/ }).click();
    await page.getByRole('button', { name: 'Add sample files' }).click();
    for (let index = 0; index < 8; index++) await page.getByRole('button', { name: 'Advance demo' }).click();
    await expect(page.locator('#status-label')).toHaveText('3 uploaded');
    for (const width of [320, 390, 600, 736, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#scenario').selectOption('missing');
      await page.locator('#upload-status').click();
      if (width <= 600) {
        await expect(page.locator('.upload-page')).toBeVisible();
        await expect(page.locator('#upload-panel')).toBeHidden();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflow at ${width}`);
      await expect(page.getByRole('button', { name: 'Locate originals (demo)', exact: true })).toBeVisible();
      if (width === 390) await page.screenshot({ path: resolve(screenshots, `${name}-recovery-phone.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: hidden arrival, batch controls, destination continuity, quiet recovery, cancel safety, completion, focus, six responsive widths.`);
  } finally { await browser.close(); }
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) await verifyWorkflow(engine, name);
