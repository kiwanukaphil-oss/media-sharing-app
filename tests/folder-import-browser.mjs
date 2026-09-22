import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';

const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const root=resolve('.sites-runtime/folder-fixture',randomUUID(),'Shoot');
const originals=[['top.bin','top-level original'],['Originals/image.bin','first same-name original'],['Edits/Day 1/image.bin','second same-name original']];
for(const [name,bytes] of originals){await mkdir(resolve(root,name,'..'),{recursive:true});await writeFile(resolve(root,name),bytes);}
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(origin);await page.getByLabel('Space name').fill('Folder import fixture');
  await page.getByRole('button',{name:'Create shared space'}).click();
  await expect(page.getByRole('button',{name:'Import folder',exact:true})).toBeVisible();
  await page.getByLabel('Choose folder to import',{exact:true}).setInputFiles(root);
  const dialog=page.getByRole('dialog',{name:'Review folder import',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/repeated filenames/)).toBeVisible();
  await expect(dialog.getByText(/Nested folders become section labels/)).toBeVisible();
  assert.equal((await (await page.request.get(origin+'/api/albums')).json()).albums.length,0,'Preview creates nothing.');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByLabel('Choose folder to import',{exact:true}).setInputFiles(root);
  await dialog.getByLabel('Section for Edits/Day 1',{exact:true}).fill('Originals');
  await expect(dialog.getByRole('button',{name:'Create album and queue files'})).toBeDisabled();
  await dialog.getByLabel('Section for Edits/Day 1',{exact:true}).fill('Polished');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/folder-import',{recursive:true});await page.screenshot({path:'outputs/folder-import/mobile.png',fullPage:true});
  // Simulate losing only the first response after the real server atomically created the layout.
  let attempts=0;
  await page.route('**/api/import-layout',async route=>{
    attempts++;
    if(attempts===1){const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({status:503,json:{error:'Fixture response interrupted. Retry this preview.'}});}
    else await route.continue();
  });
  await dialog.getByRole('button',{name:'Create album and queue files'}).click();
  await expect(dialog.getByText('Fixture response interrupted. Retry this preview.')).toBeVisible();
  await dialog.getByRole('button',{name:'Create album and queue files'}).click();
  await expect(dialog.getByText('Files queued. Follow upload progress in Transfers; queued does not mean uploaded.')).toBeVisible();
  await dialog.getByRole('button',{name:'Close folder import'}).click();
  await expect.poll(async()=>(await (await page.request.get(origin+'/api/feed')).json()).total,{timeout:30000}).toBe(3);
  const albums=await (await page.request.get(origin+'/api/albums')).json();assert.equal(albums.albums.length,1);assert.equal(attempts,2);
  const feed=await (await page.request.get(origin+'/api/feed')).json();
  const exportResponse=await page.request.post(origin+'/api/metadata-export',{headers:{Origin:origin},data:{files:feed.items.map(file=>({id:file.id,expectedRevision:file.revision}))}});
  assert.equal(exportResponse.status(),200);const metadata=await exportResponse.json();
  assert.equal(metadata.files.filter(file=>file.name==='image.bin').length,2);
  assert.deepEqual(metadata.files.map(file=>file.albums[0].section?.name||null).sort(),[null,'Originals','Polished'].sort());
  for(const file of metadata.files){const downloaded=await (await page.request.get(origin+`/api/media/${file.id}/download`)).body();
    assert.equal(createHash('sha256').update(downloaded).digest('hex'),file.sha256);
    assert.ok(originals.some(([,bytes])=>Buffer.from(bytes).equals(downloaded)));}
  assert.deepEqual(errors,[]);
  const fallback=await browser.newPage();await fallback.addInitScript(()=>{delete HTMLInputElement.prototype.webkitdirectory;});
  await fallback.goto(origin);await fallback.getByLabel('Space name').fill('File fallback fixture');await fallback.getByRole('button',{name:'Create shared space'}).click();
  await expect(fallback.getByRole('button',{name:'Import files',exact:true})).toBeVisible();
  await fallback.getByLabel('Choose files to import',{exact:true}).setInputFiles({name:'plain.bin',mimeType:'application/octet-stream',buffer:Buffer.from('plain')});
  await expect(fallback.getByText('This browser does not supply folder structure. Selected files will go directly into the new album.')).toBeVisible();
  console.log('PASS: real folder preview/cancel, collision edits, lost-response retry, single layout, exact-byte uploads with sections, mobile width and plain-file browser fallback.');
} finally {await browser.close();}
