import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8796';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const space=crypto.randomUUID(),actor=crypto.randomUUID(),peer=crypto.randomUUID(),scope=crypto.randomUUID();
const album=crypto.randomUUID();
let releaseUpload;const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});let capturedUpload=null;
let pendingCopy=null,copyRequests=0;
let granted=true,version=crypto.randomUUID(),created=null;
const file={id:crypto.randomUUID(),name:'Restricted portrait.jpg',mime:'image/jpeg',size:4,sha256:'a'.repeat(64),category:'original',createdAt:Date.now(),deviceName:'Owner',hasPreview:false,revision:0,canEdit:true,accessScopeId:scope};
// Mock only transport to exercise rendered navigation/dialog/confirmation state. Real D1 tests cover
// the same API operations, current authority, transactions and permission revocation independently.
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Audience fixture',role:'owner',kind:'shared',actorId:actor}]}});
  assert.equal(url.searchParams.get('space'),space);
  if(url.pathname==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'owner',restrictedScopes:true,transport:'local',space:{id:space,name:'Audience fixture',kind:'shared'}}});
  if(url.pathname==='/api/people')return route.fulfill({json:{currentMembershipId:actor,members:[{id:actor,name:'Fixture owner',role:'owner'},{id:peer,name:'Fixture viewer',role:'viewer'}]}});
  if(url.pathname==='/api/access-scopes'&&request.method()==='GET'){
    const scopes=[{id:scope,version,createdBy:actor},...(created?[{id:created.id,version:created.version,createdBy:actor}]:[])];
    return route.fulfill({json:url.searchParams.get('administration')==='1'?{scopes,grants:[...(granted?[{scopeId:scope,membershipId:actor,grantedAt:1}]:[]),...(created?created.members.map(membershipId=>({scopeId:created.id,membershipId,grantedAt:1})):[])]}:
      {scopes:[...(granted?[{...scopes[0],name:'Client private'}]:[]),...(created?[{...scopes[1],name:created.name}]:[])]}});
  }
  if(url.pathname==='/api/access-scopes'&&request.method()==='POST'){
    const input=request.postDataJSON();assert.equal(input.confirmAudience,true);assert.deepEqual(new Set(input.members),new Set([actor,peer]));
    created={...input,version:crypto.randomUUID()};return route.fulfill({json:{scope:{id:created.id,version:created.version},created:true}});
  }
  if(url.pathname===`/api/access-scopes/${scope}`&&request.method()==='PUT'){
    const input=request.postDataJSON();assert.equal(input.version,version);assert.equal(input.membershipId,actor);assert.equal(input.confirmAudience,true);
    if(input.grant)assert.equal(input.confirmAdministratorAccess,true);granted=input.grant;version=crypto.randomUUID();return route.fulfill({json:{version}});
  }
  if(url.pathname==='/api/feed'){
    const visible=granted&&[scope,'accessible'].includes(url.searchParams.get('scope'));
    return route.fulfill({json:{items:visible?[file]:[],total:visible?1:0,nextCursor:null,role:'owner',counts:{all:visible?1:0,original:visible?1:0,final:0,trash:0}}});
  }
  if(url.pathname==='/api/albums')return route.fulfill({json:{albums:granted&&[scope,'accessible'].includes(url.searchParams.get('scope'))?[{id:album,name:'Sensitive album',description:'',revision:0,createdAt:1,archivedAt:null,deletedAt:null,count:1}]:[],sections:[]}});
  if(url.pathname==='/api/uploads'&&request.method()==='POST'){capturedUpload=request.postDataJSON();await uploadGate;return route.fulfill({json:{id:capturedUpload.id,status:'ready',partSize:16777216}});}
  if(url.pathname==='/api/scope-copies'){
    if(request.method()==='GET')return route.fulfill({json:{publication:pendingCopy}});
    const input=request.postDataJSON();copyRequests++;assert.equal(input.sourceScopeId,scope);assert.equal(input.destinationScopeId,null);assert.equal(input.confirmed,true);
    if(!pendingCopy){pendingCopy={...input,phase:'pending'};return route.fulfill({status:503,json:{error:'Copy response interrupted. Retry the same copy.'}});}
    assert.equal(input.id,pendingCopy.id);pendingCopy.phase='ready';return route.fulfill({json:{published:true,id:input.id,destinationSpaceId:space}});
  }
  if(/\/media\/.*\/(thumbnail|preview)$/.test(url.pathname))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=','base64')});
  if(url.pathname==='/api/storage')return route.fulfill({json:{allScopeBilling:true,used:4,reserved:0,trash:0,limit:100000,uploads:[]}});
  if(url.pathname==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  throw new Error('Unexpected audience UI request '+url.pathname);
});
const choose=async(label,name)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();};
try {
  await page.goto(`${origin}/?space=${space}`);
  await expect(page.getByRole('combobox',{name:'Browse audience'})).toBeVisible();
  await expect(page.getByText(file.name,{exact:true})).toHaveCount(0);
  await choose('Browse audience','Client private');
  await expect(page.getByText(file.name,{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Restricted library.'})).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('scope'),scope);
  await page.getByRole('button',{name:`Preview ${file.name}`,exact:true}).click();
  await page.getByRole('button',{name:'Copy to another audience',exact:true}).click();
  const copyDialog=page.getByRole('dialog',{name:'Copy to another audience',exact:true});
  await expect(copyDialog.getByRole('button',{name:'Create copy',exact:true})).toBeDisabled();
  await choose('Destination audience','General library');
  await expect(copyDialog.getByText(/Fixture owner, Fixture viewer, plus paired devices/)).toBeVisible();
  await expect(copyDialog.getByText(/restricted original stays/)).toBeVisible();
  await copyDialog.getByRole('button',{name:'Create copy',exact:true}).click();
  await expect(copyDialog.getByRole('alert')).toContainText('interrupted');
  await expect(copyDialog.getByRole('combobox',{name:'Destination audience'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:`Preview ${file.name}`,exact:true}).click();
  await page.getByRole('button',{name:'Copy to another audience',exact:true}).click();
  await copyDialog.getByRole('button',{name:'Retry copy',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Copy verified',exact:true})).toBeVisible();
  assert.equal(copyRequests,2);await expect(page.getByRole('link',{name:'Open destination'})).toHaveAttribute('href',`/?space=${space}`);
  await mkdir('outputs/access-scopes',{recursive:true});await page.screenshot({path:'outputs/access-scopes/copy-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');
  await choose('Browse audience','Everything I can access');
  await expect(page.getByRole('button',{name:'Add files',exact:true})).toHaveCount(0);
  await expect(page.getByText(/Choose one audience before adding files/)).toBeVisible();
  await choose('Browse audience','Client private');
  await page.getByRole('button',{name:'Manage audiences',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Audiences',exact:true});await expect(manager).toBeVisible();
  await manager.getByLabel('Audience name',{exact:true}).fill('Event team');
  await manager.getByRole('checkbox',{name:/Fixture viewer/}).check();
  await manager.getByRole('button',{name:'Review audience',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Create Event team?',exact:true});await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText(/Fixture owner, Fixture viewer/)).toBeVisible();
  await confirmation.getByRole('button',{name:'Create audience',exact:true}).click();
  await expect(manager.getByText(/Audience created/)).toBeVisible();
  await choose('Manage audience','Client private');
  await manager.getByRole('button',{name:'Remove access',exact:true}).click();
  await page.getByRole('dialog',{name:'Remove audience access?',exact:true}).getByRole('button',{name:'Remove access',exact:true}).click();
  await expect(manager.getByText('Audience access removed.',{exact:true})).toBeVisible();
  await expect(page.getByText(file.name,{exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Browse audience'})).toContainText('Audience unavailable');
  await manager.getByRole('button',{name:'Grant access',exact:true}).first().click();
  const self=page.getByRole('dialog',{name:'Grant yourself administrator access?',exact:true});await expect(self).toBeVisible();
  await expect(self.getByText(/will be recorded in the audit/)).toBeVisible();await self.getByRole('button',{name:'Grant access',exact:true}).click();
  await expect(manager.getByText('Audience access granted.',{exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mkdir('outputs/access-scopes',{recursive:true});await page.screenshot({path:'outputs/access-scopes/mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(manager).toHaveCount(0);
  await expect(page.getByText(file.name,{exact:true})).toBeVisible();
  await choose('Browse audience','General library');await expect(page.getByText(file.name,{exact:true})).toHaveCount(0);
  await page.setViewportSize({width:1280,height:900});
  await choose('Browse audience','Client private');
  await page.getByRole('button',{name:/Sensitive album/}).first().click();
  await expect.poll(()=>new URL(page.url()).searchParams.get('album')).toBe(album);
  assert.equal(new URL(page.url()).searchParams.get('scope'),scope,'Album navigation preserves the selected audience.');
  await page.getByLabel('Choose original files',{exact:true}).setInputFiles({name:'Scoped queue.txt',mimeType:'text/plain',buffer:Buffer.from('Keep this scope')});
  await expect.poll(()=>capturedUpload?.accessScopeId).toBe(scope);
  await choose('Browse audience','General library');releaseUpload();
  await expect(page.getByText('Available in destination library',{exact:true})).toBeVisible();
  assert.equal(capturedUpload.accessScopeId,scope);assert.equal(capturedUpload.albumId,album);
  await page.screenshot({path:'outputs/access-scopes/desktop.png',fullPage:true});
  console.log('PASS: mobile audience navigation, explicit combined browsing, initial audience review, revoked-content clearing, audited self-access confirmation and keyboard dismissal.');
} finally {await browser.close();}
