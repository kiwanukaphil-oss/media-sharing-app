import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';

const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8796';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(10000);
const id=crypto.randomUUID(),person=crypto.randomUUID(),space=crypto.randomUUID(),album=crypto.randomUUID();
let signedIn=false,accepted=false,receipt=null,partAttempts=0,reservations=0,ownerRequest=null;
const request={id,title:'Wedding originals',receivingLibrary:'Studio library',expiresAt:Date.now()+86400000,maxFiles:20,maxFileBytes:262144000,maxBytes:1073741824,remainingFiles:20,remainingBytes:1073741824};
// Transport mocks exercise real rendered account handoff, paused part retry and owner confirmation.
// Separate workerd tests exercise the real D1/R2 APIs and authority boundaries.
await page.route('**/api/**',async route=>{
  const call=route.request(),url=new URL(call.url()),path=url.pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{enabled:true,account:signedIn?{sessionId:person,displayName:'Recipient',verifiedEmail:'recipient@example.test'}:null}});
  if(path==='/api/auth/sessions')return route.fulfill({json:{sessions:[]}});
  if(path==='/api/auth/spaces')return route.fulfill({json:{spaces:[{id:space,name:'Studio library',role:'owner',kind:'shared',actorId:person}]}});
  if(path==='/api/intake/preview'){assert.equal(call.postDataJSON().token,'a'.repeat(64));return route.fulfill({json:request});}
  if(path==='/api/intake/accept'){accepted=true;return route.fulfill({json:request});}
  if(path===`/api/intake/requests/${id}`){assert.equal(accepted,true);return route.fulfill({json:{request:{...request,remainingFiles:receipt?19:20,remainingBytes:request.maxBytes-(receipt?.size||0)},receipts:receipt?[receipt]:[],account:{personId:person,verifiedEmail:'recipient@example.test'}}});}
  if(path==='/api/intake/uploads'){
    const body=call.postDataJSON();reservations++;
    if(receipt)assert.equal(body.id,receipt.id,'Retry must preserve the original submission');
    assert.equal(body.sha256,createHash('sha256').update('tiny').digest('hex'));
    receipt={...body,phase:'uploading'};return route.fulfill({json:{id:body.id,status:'uploading',partSize:16777216}});
  }
  if(path.endsWith('/part'))return route.fulfill({json:{url:'/api/intake-part'}});
  if(path==='/api/intake-part'){partAttempts++;return route.fulfill(partAttempts===1?{status:503,body:'Interrupted'}:{status:200,headers:{ETag:'verified-part'},body:''});}
  if(path.endsWith('/complete')){assert.deepEqual(call.postDataJSON().parts,[{partNumber:1,etag:'verified-part'}]);receipt.phase='received';return route.fulfill({json:{received:true,verified:false}});}
  if(path==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:person,role:'owner',uploadRequests:true,restrictedScopes:false,transport:'local',space:{id:space,name:'Studio library',kind:'shared'}}});
  if(path==='/api/feed')return route.fulfill({json:{items:[],total:0,nextCursor:null,role:'owner',counts:{all:0,original:0,final:0,trash:0}}});
  if(path==='/api/albums')return route.fulfill({json:{albums:[{id:album,name:'Wedding',description:'',count:0,revision:0}],sections:[]}});
  if(path==='/api/sections')return route.fulfill({json:{sections:[]}});
  if(path==='/api/upload-requests'&&call.method()==='POST'){ownerRequest=call.postDataJSON();assert.equal(ownerRequest.confirmed,true);assert.equal(ownerRequest.albumId,album);assert.equal(ownerRequest.accessScopeId,null);return route.fulfill({json:{id:ownerRequest.id}});}
  if(path==='/api/upload-requests')return route.fulfill({json:{requests:ownerRequest?[{...ownerRequest,state:'open',revision:0}]:[]}});
  if(path.startsWith('/api/upload-requests/')&&call.method()==='POST'){receipt.phase=path.endsWith('/decline')?'rejected':path.endsWith('/restore')?'received':'accepted';return route.fulfill({json:{}});}
  if(path.startsWith('/api/upload-requests/'))return route.fulfill({json:{submissions:receipt?[receipt]:[]}});
  if(path==='/api/storage')return route.fulfill({json:{usedBytes:0,limitBytes:1073741824,reservedBytes:0}});
  return route.fulfill({json:{}});
});
try{
  await page.goto(`${origin}/collect#request=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading',{name:'Your upload request'})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  await page.getByRole('link',{name:'Continue to sign in'}).click();
  signedIn=true;await page.reload();
  await expect(page.getByRole('heading',{name:'Wedding originals'})).toBeVisible();
  await page.getByRole('button',{name:'Accept and choose files'}).click();
  await expect(page.getByText('Sending as recipient@example.test')).toBeVisible();
  const file={name:'tiny.txt',mimeType:'text/plain',buffer:Buffer.from('tiny')};
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText("That part didn't arrive");
  const originalId=receipt.id;await page.reload();
  await expect(page.getByText(/Unfinished: choose the same original/)).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByText('Received, awaiting organiser review',{exact:false})).toBeVisible();
  assert.equal(receipt.id,originalId);assert.equal(reservations,2);assert.equal(partAttempts,2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('outputs/intake',{recursive:true});await page.screenshot({path:'outputs/intake/recipient-mobile.png',fullPage:true});
  await page.goto(`${origin}/?space=${space}`);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Upload requests',exact:true}).click();
  await page.getByRole('button',{name:'New request'}).click();
  await page.getByLabel('Title the recipient sees').fill('Wedding originals');
  await page.getByLabel('Recipient email',{exact:true}).fill('recipient@example.test');
  await page.getByRole('combobox',{name:'Collection album',exact:true}).click();
  await page.getByRole('option',{name:'Wedding',exact:true}).click();
  await page.getByRole('button',{name:'Review request',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Create upload request?'})).toContainText('recipient@example.test');
  await page.getByRole('button',{name:'Create request',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ready to collect.'})).toBeVisible();
  assert.match(await page.getByLabel('Request link').inputValue(),/\/collect#request=[a-f0-9]{64}$/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'outputs/intake/owner-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Review submissions',exact:true}).click();
  await expect(page.getByRole('link',{name:'Verify and download'})).toBeVisible();
  await page.screenshot({path:'outputs/intake/review-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Decline',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Decline this original?'})).toContainText('storage reservation are retained');
  await page.getByRole('button',{name:'Decline original',exact:true}).click();
  await page.getByRole('button',{name:'Restore to review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Verify and accept',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'outputs/intake/owner-desktop.png',fullPage:true});
  console.log('PASS intake browser: secret-fragment sign-in handoff, explicit acceptance, exact interrupted retry, review receipts and owner destination confirmation at mobile/desktop widths');
}finally{await browser.close();}
