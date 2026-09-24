import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(),actor=crypto.randomUUID();
const item={id:crypto.randomUUID(),name:'Shared original.jpg',mime:'image/jpeg',size:4,sha256:'a'.repeat(64),category:'original',createdAt:Date.now(),deviceName:'Another member',hasPreview:false,revision:0};
let denied=false,more=false,updated=false;
const event=(id,action,changedSince=0)=>({id,action,changedSince,affectedCount:1,actor:'Another member',createdAt:Date.now()});
// Mock transport isolates history presentation; real D1 tests exercise authority and atomicity.
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Viewer library',role:'viewer',kind:'shared',actorId:actor}]}});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'viewer',transport:'local',space:{id:space,name:'Viewer library',kind:'shared'}}});
  if(url.pathname==='/api/feed')return route.fulfill({json:{items:[{...item,canEdit:false}],total:1,nextCursor:null,role:'viewer',counts:{all:1,original:1,final:0,trash:0}}});
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:[],sections:[]}});
  if(url.pathname==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname==='/api/activity'){
    if(denied)return route.fulfill({status:403,json:{error:'Library access changed. Refresh to continue.'}});
    if(url.searchParams.has('before')){more=true;return route.fulfill({json:{events:[event('3','file.arrive')],next:null}});}
    return route.fulfill({json:{events:[event(updated?'new':'1','file.rename',1),event('2','file.delete')],next:'older'}});
  }
  throw new Error('Unexpected activity UI request '+url.pathname);
});
try {
  await page.clock.install();
  await page.goto(`${origin}/?view=files&space=${space}`);
  const opener=page.getByRole('button',{name:'Library activity',exact:true});await opener.click();
  const dialog=page.getByRole('dialog',{name:'Activity',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Renamed files',{exact:true})).toBeVisible();
  await expect(dialog.getByText(/Changed since/)).toBeVisible();
  await expect(dialog.getByText(/Cannot be undone/)).toBeVisible();
  await expect(dialog.getByText('Shared original.jpg')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Earlier activity'}).click();assert.equal(more,true);
  await expect(dialog.getByText('Added an original',{exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/activity',{recursive:true});await page.screenshot({path:'outputs/activity/mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  updated=true;await page.clock.fastForward(61000);
  await expect(page.getByRole('button',{name:'Library activity, new updates'})).toBeVisible();
  await expect(page.getByText('New library activity is available.',{exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Library activity, new updates'}).click();denied=true;await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(dialog.getByText('Library access changed. Refresh to continue.')).toBeVisible();
  await expect(dialog.getByText('Renamed files',{exact:true})).toHaveCount(0);
  console.log('PASS: compact mobile history, later-edit/permanent labels, bounded paging, Escape/focus return and stale-history removal after access denial.');
} finally {await browser.close();}
