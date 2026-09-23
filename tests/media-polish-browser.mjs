import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Use actual browser-generated media to verify posters, playback and byte-preserving downloads together.
try {
  await page.goto(origin);
  await page.getByLabel('Space name').fill('Studio workspace');
  await page.getByLabel('Device name', { exact: true }).fill('Studio desktop');
  await page.getByRole('button', { name: 'Create shared space' }).click();
  await expect(page.getByLabel('Search filenames')).toBeVisible();
  const fixtures = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 960, 600);
    gradient.addColorStop(0, '#c9e5e0'); gradient.addColorStop(1, '#395953');
    context.fillStyle = gradient; context.fillRect(0, 0, 960, 600);
    context.fillStyle = '#f4eee2'; context.beginPath(); context.ellipse(480, 380, 180, 110, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#bf9472'; context.fillRect(370, 220, 220, 160);
    context.fillStyle = '#dac0a6'; context.beginPath(); context.ellipse(480, 220, 110, 35, 0, 0, Math.PI * 2); context.fill();
    const photo = canvas.toDataURL('image/png').split(',')[1];
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    const frames = setInterval(() => { context.fillStyle = '#f4eee2'; context.fillRect(40, 40, 40, 40); }, 70);
    await new Promise(resolve => setTimeout(resolve, 1000));
    recorder.stop(); await stopped; clearInterval(frames); stream.getTracks().forEach(track => track.stop());
    return { photo, video: Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())) };
  });
  const videoBytes = Buffer.from(fixtures.video);
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles([
    { name: 'Ceramic collection - studio original.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.photo, 'base64') },
    { name: 'Studio process.webm', mimeType: 'video/webm', buffer: videoBytes },
    { name: 'Camera negative.dng', mimeType: 'application/octet-stream', buffer: Buffer.from('Original camera fixture') },
  ]);
  const videoCard = page.locator('article').filter({ hasText: 'Studio process.webm' });
  const imageCard = page.locator('article').filter({ hasText: 'Ceramic collection' });
  await expect(videoCard.locator('img')).toBeVisible({ timeout: 30000 });
  await expect(imageCard.locator('img')).toBeVisible();
  // The gallery viewer preserves ordering, keyboard focus, metadata access, and image zoom.
  await imageCard.getByRole('button', { name: /^Preview / }).click();
  await expect(page.locator('.viewer-details')).toBeHidden();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.viewer-stage')).toHaveClass(/is-zoomed/);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'File details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Original file fingerprint');
  const names = await page.locator('article h3').allTextContents();
  const currentIndex = names.indexOf('Ceramic collection - studio original.png');
  const direction = currentIndex < names.length - 1 ? 1 : -1;
  await page.keyboard.press(direction === 1 ? 'ArrowRight' : 'ArrowLeft');
  await expect(page.locator('.viewer-file h2')).toHaveText(names[currentIndex + direction]);
  await page.keyboard.press('Escape');
  await expect(imageCard.getByRole('button', { name: /^Preview / })).toBeFocused();
  await videoCard.getByRole('button', { name: 'Preview Studio process.webm', exact: true }).click();
  const video = page.locator('dialog video');
  await expect(video).toHaveAttribute('poster', /\/thumbnail$/);
  await video.evaluate(async element => { await element.play(); element.pause(); });
  await page.keyboard.press('Escape');
  const downloadPromise = page.waitForEvent('download');
  await videoCard.getByRole('button', { name: 'Save to device', exact: true }).click();
  assert.deepEqual(await readFile(await (await downloadPromise).path()), videoBytes);
  await page.getByLabel('Search filenames').fill('Studio process');
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Dismiss completed transfers' }).click();
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 });
  await page.locator('.topbar').hover();
  await mkdir('outputs/phase-3', { recursive: true });
  await page.screenshot({ path: 'outputs/phase-3/desktop.png', fullPage: true, animations: 'disabled' });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No overflow at ${width}px`);
    if (await page.locator('.category-filter-disclosure').getAttribute('open') === null) await page.locator('.category-filter-disclosure summary').click();
    await expect(page.locator('.filter-tabs').getByRole('button', { name: /Final cuts/ })).toBeVisible();
    if (width === 390) await page.screenshot({ path: 'outputs/phase-3/mobile.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    await imageCard.getByRole('button', { name: /^Preview / }).click();
    assert.equal(await page.evaluate(() => document.querySelector('.media-viewer').scrollWidth > innerWidth), false, `Viewer fits ${width}px`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `List fits ${width}px`);
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  }
  await page.route('**/thumbnail', route => route.abort());
  await page.reload();
  await expect(videoCard.getByText('Original ready to save', { exact: true })).toBeVisible();
  await expect(videoCard.getByRole('button', { name: 'Save to device', exact: true })).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log('PASS: photo/video posters, original video playback, exact-byte download, clear search, responsive navigation (320/390/768px), failed-preview fallback.');
} finally { await browser.close(); }
