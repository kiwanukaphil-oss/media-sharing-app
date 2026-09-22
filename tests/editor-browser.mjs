import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI ? {} : {channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(), actor=crypto.randomUUID();
const item={id:crypto.randomUUID(),name:'Another member original.jpg',mime:'image/jpeg',size:4,sha256:'a'.repeat(64),category:'original',createdAt:Date.now(),deviceName:'Another member',hasPreview:false,revision:0};
let mutations=0;
let role='editor';
// UI capability presentation is isolated here; actual role changes and metadata/storage denial run
// against D1 in account-space-access, space-people and library-write-authority.
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if (request.method()!=='GET') mutations++;
  if(url.pathname==='/api/auth/spaces') return route.fulfill({json:{spaces:[{id:space,name:'Editor library',role:'editor',kind:'shared',actorId:actor}]}});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname==='/api/session') return route.fulfill({json:{authentication:'account',personId:'editor-person',deviceId:actor,role,transport:'local',space:{id:space,name:'Editor library',kind:'shared'}}});
  if(url.pathname==='/api/feed') return route.fulfill({json:{items:[{...item,archivedAt:url.searchParams.get('category')==='trash'?Date.now():null}],total:1,nextCursor:null,role,counts:{all:1,original:1,final:0,trash:1}}});
  if(url.pathname==='/api/albums') return route.fulfill({json:{albums:[],sections:[]}});
  if(url.pathname==='/api/storage') return route.fulfill({json:{used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  throw new Error(`Unexpected editor browser request ${url.pathname}`);
});
try {
  await page.goto(`${origin}/?space=${space}`);
  await expect(page.getByRole('button',{name:'New album',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rename',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Move to Trash',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pair a device',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await expect(page.getByText('Editor / Account access',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Trash/}).click();
  await expect(page.getByRole('button',{name:'Restore',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete permanently',exact:true})).toHaveCount(0);
  role='member';
  await page.getByLabel('Search filenames').fill('Another');
  await expect(page.getByRole('button',{name:'Restore',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'New album',exact:true})).toHaveCount(0);
  role='viewer';
  await page.goto(`${origin}/?space=${space}`);
  await expect(page.getByRole('button',{name:'Add files',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Rename',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save to device',exact:true})).toBeVisible();
  assert.equal(mutations,0);
  console.log('PASS: Editor organisation controls and role label, Trash restoration, no device pairing or permanent-delete controls.');
} finally {await browser.close();}
