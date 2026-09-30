import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium, webkit, expect } from '@playwright/test';
const origin = process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8788';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await (process.env.RELAY_BULK_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${origin}/?view=files`);
  await page.getByLabel('Space name').fill('Bulk download fixture');
  await page.getByRole('button', { name: 'Create shared space', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add files', exact: true }).first()).toBeEnabled();
  await page.getByLabel('Choose original files', { exact: true }).setInputFiles([1, 2].map(index => ({ name: 'Same name.txt', mimeType: 'text/plain', buffer: Buffer.from(`Original ${index}`) })));
  await expect(page.getByText('All files delivered', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Select loaded files (2)')).toBeVisible();
  await page.getByLabel('Select loaded files (2)').click();
  await page.getByRole('button', { name: 'Save selected to device', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2 files');
  await expect(page.getByRole('dialog')).toContainText('On iPhone');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download ZIP', exact: true }).click();
  const result = await download;
  assert.equal(result.suggestedFilename(), 'relay-originals.zip');
  const output = `.sites-runtime/bulk-${process.env.RELAY_BULK_BROWSER || 'chromium'}.zip`;
  await mkdir('.sites-runtime', { recursive: true });
  await result.saveAs(output);
  // Independent ZIP reader checks flat collision-safe names, CRCs, manifest and unchanged originals.
  const checked = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as archive:
 assert archive.testzip() is None
 manifest=json.loads(archive.read('manifest.json'))
 assert len(manifest['files'])==2
 names=[file['suggestedPath'] for file in manifest['files']]
 assert len(set(names))==2 and all('/' not in name for name in names)
 assert sorted(archive.read(name) for name in names)==[b'Original 1',b'Original 2']
`, output], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const feed = await (await page.request.get(`${origin}/api/feed`)).json();
  const ids = feed.items.map(item => item.id).join(',');
  assert.equal((await page.request.get(`${origin}/api/bulk-download?ids=${feed.items[0].id},${feed.items[0].id}&check=1`)).status(), 400);
  const stranger = await browser.newContext();
  assert.equal((await stranger.request.get(`${origin}/api/bulk-download?ids=${ids}`)).status(), 401);
  const connected = await stranger.request.post(`${origin}/api/connect`, { headers: { origin }, data: { name: 'Other person', spaceName: 'Other library' } });
  assert.equal(connected.status(), 200);
  assert.equal((await stranger.request.get(`${origin}/api/bulk-download?ids=${ids}`)).status(), 404);
  await stranger.close();
  const invitation = await (await page.request.post(`${origin}/api/invitations`, { headers: { origin } })).json();
  const member = await browser.newContext();
  const joined = await member.request.post(`${origin}/api/connect`, { headers: { origin }, data: { name: 'Read and save member', invitation: invitation.token } });
  assert.equal(joined.status(), 200);
  const memberPage = await member.newPage(); await memberPage.goto(`${origin}/?view=files`);
  await memberPage.getByLabel('Select loaded files (2)').click();
  await expect(memberPage.getByRole('button', { name: 'Save selected to device', exact: true })).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Move selected to Trash', exact: true })).toHaveCount(0);
  assert.equal((await member.request.get(`${origin}/api/bulk-download?ids=${ids}&check=1`)).status(), 200);
  await member.close();
  await page.getByRole('button', { name: 'Close bulk download' }).click();
  assert.equal((await page.request.post(`${origin}/api/media/${feed.items[0].id}/archive`, { headers: { origin } })).status(), 200);
  assert.equal((await page.request.get(`${origin}/api/bulk-download?ids=${ids}&check=1`)).status(), 409);
  assert.deepEqual(errors, []);
  console.log('PASS: phone-sized bulk action, native ZIP download, independent CRC/exact-byte extraction, duplicate names, read-only member toolbar, auth/foreign-library/archived-file rejection.');
} finally { await browser.close(); }
