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
const album=crypto.randomUUID(),candidate={...item,id:crypto.randomUUID(),name:'Existing original.jpg',accessScopeId:null,revision:0};let denied=false,added=false;const source={id:item.id,name:item.name,size:item.size,sha256:item.sha256,revision:0,accessScopeId:null};
await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Duplicate review library',role:'owner',kind:'shared',actorId:actor}]}});
  if(url.pathname==='/api/generated-package-original')return route.fulfill({body:Buffer.from('tiny')});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname.endsWith('/link'))return route.fulfill({json:{url:'/api/generated-package-original'}});
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'owner',transport:'local',space:{id:space,name:'Duplicate review library',kind:'shared'}}});
  if(url.pathname==='/api/feed')return route.fulfill({json:{items:[{...item,canEdit:false}],total:1,nextCursor:null,role:'owner',counts:{all:1,original:1,final:0,trash:0}}});
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:[{id:album,name:'Reviewed album',description:'',accessScopeId:null,archivedAt:null,revision:0,count:0}],sections:[]}});
  if(url.pathname==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  if(url.pathname==='/api/duplicate-candidates')return route.fulfill(denied?{status:409,json:{error:'This file or your access changed.'}}:{json:{source,candidates:[candidate],hasMore:false}});
  if(url.pathname==='/api/library/organise'){
    const body=request.postDataJSON();assert.equal(body.albumId,album);assert.deepEqual(body.files,[{id:candidate.id,expectedRevision:candidate.revision}]);
    assert.equal(body.action,added?'remove':'add');added=!added;candidate.revision++;return route.fulfill({json:{changed:[{id:candidate.id}],files:[{id:candidate.id,revision:candidate.revision}]}});
  }
  throw new Error('Unexpected metadata UI request '+url.pathname);
});
try {
  await page.goto(`${origin}/?space=${space}`);
  await page.getByRole('checkbox',{name:/Select loaded files/}).click();
  await page.getByRole('button',{name:'Find duplicate originals',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Duplicate originals',exact:true});await expect(dialog.getByText('Existing original.jpg',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Matching recorded fingerprint',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Add existing to album'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Verify originals',exact:true}).click();await expect(dialog.getByText('Identical bytes verified',{exact:true})).toBeVisible();
  await dialog.getByRole('combobox',{name:'Album for existing original',exact:true}).click();await page.getByRole('option',{name:'Reviewed album',exact:true}).click();
  await dialog.getByRole('button',{name:'Add existing to album',exact:true}).click();await expect(dialog.getByText('Existing original added to the album. Both files remain intact.',{exact:true})).toBeVisible();assert.equal(added,true);
  await dialog.getByRole('button',{name:'Undo album addition',exact:true}).click();await expect(dialog.getByText('Album reference removed. Original files are unchanged.',{exact:true})).toBeVisible();assert.equal(added,false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('outputs/duplicates',{recursive:true});await page.screenshot({path:'outputs/duplicates/mobile.png',fullPage:true});
  await page.keyboard.press('Escape');denied=true;await page.getByRole('button',{name:'Find duplicate originals',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('access changed');await expect(dialog.getByText('Existing original.jpg',{exact:true})).toHaveCount(0);
  console.log('PASS duplicate browser: candidate wording, independent verification, deliberate album reuse and Undo, mobile layout and revoked-name clearing');
} finally {await browser.close();}
