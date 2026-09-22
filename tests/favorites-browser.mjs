import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(),actor=crypto.randomUUID();
const item={id:crypto.randomUUID(),name:'Shared original.jpg',mime:'image/jpeg',size:4,sha256:'a'.repeat(64),category:'original',createdAt:Date.now(),deviceName:'Another member',hasPreview:false,revision:0};
let favorite=false,deny=false,writes=0;
// UI fixture proves explicit personal bookmark state, filtered removal and failed-save messaging.
// Real D1/authority and person isolation are exercised separately by personal-favorites/API tests.
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Viewer library',role:'viewer',kind:'shared',actorId:actor}]}});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',personId:'viewer',deviceId:actor,role:'viewer',transport:'local',space:{id:space,name:'Viewer library',kind:'shared'}}});
  if(url.pathname==='/api/feed') {
    const items=url.searchParams.get('favorites')==='1'&&!favorite?[]:[{...item,isFavorite:favorite,canEdit:false}];
    return route.fulfill({json:{items,total:items.length,nextCursor:null,role:'viewer',counts:{all:1,original:1,final:0,trash:0}}});
  }
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:[],sections:[]}});
  if(url.pathname==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname===`/api/favorites/${item.id}`) {
    assert.equal(request.method(),'PUT');writes++;
    assert.deepEqual(Object.keys(request.postDataJSON()),['favorite']);
    if(deny)return route.fulfill({status:409,json:{error:'Library access changed. Refresh before updating favourites.'}});
    favorite=request.postDataJSON().favorite;return route.fulfill({json:{favorite}});
  }
  throw new Error('Unexpected favourites UI request '+url.pathname);
});
try {
  await page.goto(`${origin}/?space=${space}`);
  await expect(page.getByRole('button',{name:'Add files',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Add to my favourites',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove from my favourites',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('Saved to your favourites. Only you see this bookmark.')).toBeVisible();
  await page.getByRole('button',{name:/^Filters/}).click();
  await page.getByRole('combobox',{name:'Personal view',exact:true}).click();
  await page.getByRole('option',{name:'My favourites',exact:true}).click();
  await expect(page).toHaveURL(/favorites=1/);
  await page.reload();
  await expect(page.getByRole('button',{name:'Remove from my favourites',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove from my favourites',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No files in this view.'})).toBeVisible();
  await page.getByRole('button',{name:'Clear search and filters',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add to my favourites',exact:true})).toBeVisible();
  deny=true;
  await page.getByRole('button',{name:'Add to my favourites',exact:true}).click();
  await expect(page.getByText('Library access changed. Refresh before updating favourites.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Add to my favourites',exact:true})).toHaveAttribute('aria-pressed','false');
  assert.equal(writes,3);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/favorites',{recursive:true});await page.screenshot({path:'outputs/favorites/mobile.png',fullPage:true});
  console.log('PASS: Viewer private-star control, filtered reload/removal, failed-save truthfulness and mobile width.');
} finally {await browser.close();}
