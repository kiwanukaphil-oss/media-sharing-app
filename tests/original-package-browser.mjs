import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(),actor=crypto.randomUUID();
const item={id:crypto.randomUUID(),name:'Shared original.jpg',mime:'image/jpeg',size:4,sha256:createHash('sha256').update('tiny').digest('hex'),category:'original',createdAt:Date.now(),deviceName:'Another member',hasPreview:false,revision:0};
let denied=false,exports=0;
await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Viewer library',role:'viewer',kind:'shared',actorId:actor}]}});
  if(url.pathname==='/api/generated-package-original')return route.fulfill({body:Buffer.from('tiny')});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname.endsWith('/link'))return route.fulfill({json:{url:'/api/generated-package-original'}});
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'viewer',transport:'local',space:{id:space,name:'Viewer library',kind:'shared'}}});
  if(url.pathname==='/api/feed')return route.fulfill({json:{items:[{...item,canEdit:false}],total:1,nextCursor:null,role:'viewer',counts:{all:1,original:1,final:0,trash:0}}});
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:[],sections:[]}});
  if(url.pathname==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  if(url.pathname==='/api/metadata-export'){
    assert.equal(request.method(),'POST');assert.deepEqual(request.postDataJSON(),{files:[{id:item.id,expectedRevision:0}]});exports++;
    if(denied)return route.fulfill({status:409,json:{error:'A selected file or your access changed. Refresh and select the files again.'}});
    return route.fulfill({json:{format:'relay-metadata',formatVersion:1,includesOriginalBytes:false,files:[{...item,suggestedPath:`files/${item.id}/${item.name}`,albums:[{name:'Reviewed album',section:{name:'Custom section'}}]}]}});
  }
  throw new Error('Unexpected metadata UI request '+url.pathname);
});
try {
  await page.goto(`${origin}/?space=${space}`);
  await page.getByRole('checkbox',{name:/Select loaded files/}).click();
  await expect(page.getByRole('button',{name:'Rename selected',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Move selected to Trash',exact:true})).toHaveCount(0);
  const opener=page.getByRole('button',{name:'Download originals',exact:true});await opener.click();
  const dialog=page.getByRole('dialog',{name:'Download originals',exact:true});
  await expect(dialog.getByText(/embedded metadata/)).toBeVisible();assert.equal(exports,0);
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Create ZIP',exact:true}).click();
  const download=await pending;assert.equal(download.suggestedFilename(),'relay-originals.zip');
  const {readFile}=await import('node:fs/promises');const archive=await readFile(await download.path());
  assert.equal(archive.readUInt32LE(0),0x04034b50);assert.ok(archive.includes(Buffer.from('Custom section')));assert.ok(archive.includes(Buffer.from('tiny')));
  await expect(dialog.getByRole('status')).toContainText('Package verified; download requested');assert.equal(exports,2,'Recheck complete selection before commit.');
  denied=true;await dialog.getByRole('button',{name:'Create ZIP',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('access changed');await expect(dialog.getByRole('status')).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/packages',{recursive:true});await page.screenshot({path:'outputs/packages/viewer-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(opener).toBeFocused();
  console.log('PASS library packages: Viewer export, scoped authority, manifest organisation, complete-selection revalidation, actual ZIP download, honest status and denied-access retry');
} finally {await browser.close();}
