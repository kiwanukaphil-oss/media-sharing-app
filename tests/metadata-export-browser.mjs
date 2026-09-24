import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(),actor=crypto.randomUUID();
const item={id:crypto.randomUUID(),name:'Shared original.jpg',mime:'image/jpeg',size:4,sha256:'a'.repeat(64),category:'original',createdAt:Date.now(),deviceName:'Another member',hasPreview:false,revision:0};
let denied=false,exports=0;
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Viewer library',role:'viewer',kind:'shared',actorId:actor}]}});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'viewer',transport:'local',space:{id:space,name:'Viewer library',kind:'shared'}}});
  if(url.pathname==='/api/feed')return route.fulfill({json:{items:[{...item,canEdit:false}],total:1,nextCursor:null,role:'viewer',counts:{all:1,original:1,final:0,trash:0}}});
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:[],sections:[]}});
  if(url.pathname==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  if(url.pathname==='/api/metadata-export'){
    assert.equal(request.method(),'POST');assert.deepEqual(request.postDataJSON(),{files:[{id:item.id,expectedRevision:0}]});exports++;
    if(denied)return route.fulfill({status:409,json:{error:'A selected file or your access changed. Refresh and select the files again.'}});
    return route.fulfill({json:{format:'relay-metadata',formatVersion:1,includesOriginalBytes:false,files:[{id:item.id,name:item.name,albums:[]}]}});
  }
  throw new Error('Unexpected metadata UI request '+url.pathname);
});
try {
  await page.goto(`${origin}/?view=files&space=${space}`);
  await page.getByRole('checkbox',{name:/Select loaded files/}).click();
  await expect(page.getByRole('button',{name:'Rename selected',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Move selected to Trash',exact:true})).toHaveCount(0);
  const opener=page.getByRole('button',{name:'Export selected metadata',exact:true});await opener.click();
  const dialog=page.getByRole('dialog',{name:'Export metadata',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/metadata only/)).toBeVisible();assert.equal(exports,0,'Opening a preview does not create a download.');
  const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download metadata',exact:true}).click();
  const download=await downloadPromise;assert.match(download.suggestedFilename(),/^relay-metadata-.*\.json$/);
  const {readFile}=await import('node:fs/promises');const manifest=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(manifest.includesOriginalBytes,false);assert.equal(manifest.files[0].id,item.id);
  await expect(dialog.getByText('Metadata download started. Original files are downloaded separately.')).toBeVisible();
  denied=true;await dialog.getByRole('button',{name:'Download metadata',exact:true}).click();
  await expect(dialog.getByText(/A selected file or your access changed/)).toBeVisible();
  await expect(dialog.getByText('Metadata download started. Original files are downloaded separately.')).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/metadata-export',{recursive:true});await page.screenshot({path:'outputs/metadata-export/mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(opener).toBeFocused();assert.equal(exports,2);
  console.log('PASS: Viewer read-only selection, explicit metadata preview, actual JSON download, honest download-start status, conflict recovery and keyboard/mobile layout.');
} finally {await browser.close();}
