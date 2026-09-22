import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
const origin=process.env.RELAY_TEST_ORIGIN||'http://127.0.0.1:8798';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
// Native browser downloads need an actual HTTP body; intercepted attachment responses can be cancelled by Chromium.
const originalServer=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Reviewed original.txt"'});response.end('tiny');});
await new Promise(resolve=>originalServer.listen(0,'127.0.0.1',resolve));
const originalUrl=`http://127.0.0.1:${originalServer.address().port}/original`;
const browser=await chromium.launch(process.env.CI?{}:{channel:'chrome'});
const page=await browser.newPage({acceptDownloads:true,viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
const space=crypto.randomUUID(),scope=crypto.randomUUID(),actor=crypto.randomUUID(),recipient=crypto.randomUUID();
const file={id:crypto.randomUUID(),name:'Reviewed original.txt',mime:'application/octet-stream',size:4,sha256:createHash('sha256').update('tiny').digest('hex'),category:'original',createdAt:1,deviceName:'Owner',hasPreview:false,revision:0,canEdit:true,accessScopeId:scope};
let draft=null,entry=null,signedIn=true,mode='owner',accepted=false,unavailable=false;
// Mock transport while exercising rendered selection, server review, publishing confirmation,
// secret-fragment sign-in handoff, native download wording, verified saves and revoked-state clearing.
await page.route('**/api/**',async route=>{
  const call=route.request(),url=new URL(call.url()),path=url.pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{enabled:true,account:signedIn?{sessionId:recipient,displayName:'Recipient',verifiedEmail:'recipient@example.test'}:null}});
  if(path==='/api/auth/sessions')return route.fulfill({json:{sessions:[]}});
  if(path==='/api/auth/spaces')return route.fulfill({json:{spaces:mode==='owner'?[{id:space,name:'Secret working studio',role:'owner',kind:'shared',actorId:actor}]:[]}});
  if(path==='/api/session')return route.fulfill({json:{authentication:'account',deviceId:actor,role:'owner',deliveries:true,restrictedScopes:true,transport:'local',space:{id:space,name:'Secret working studio',kind:'shared'}}});
  if(path==='/api/access-scopes')return route.fulfill({json:{scopes:[{id:scope,name:'Client private'}]}});
  if(path==='/api/feed')return route.fulfill({json:{items:[file],total:1,nextCursor:null,role:'owner',counts:{all:1,original:1,final:0,trash:0}}});
  if(path==='/api/albums')return route.fulfill({json:{albums:[],sections:[]}});
  if(path==='/api/activity')return route.fulfill({json:{events:[],next:null}});
  if(path==='/api/storage')return route.fulfill({json:{used:4,reserved:0,trash:0,limit:1073741824,uploads:[]}});
  if(path==='/api/deliveries'&&call.method()==='POST'){
    draft=call.postDataJSON();assert.equal(draft.confirmAudienceExpansion,true);assert.deepEqual(draft.files,[{id:file.id,revision:0}]);assert.equal(draft.accessScopeId,scope);
    assert.equal(draft.senderName,'Studio public');assert.equal(draft.recipients[0].email,'recipient@example.test');
    entry={...draft,fileCount:1,totalBytes:4,audienceName:'Client private',state:'draft',revision:0,canIssue:true};return route.fulfill({json:{id:draft.id,state:'draft',revision:0}});
  }
  if(path==='/api/deliveries')return route.fulfill({json:{deliveries:entry?[entry]:[],serverTime:Date.now()}});
  if(path.startsWith('/api/deliveries/')&&path.endsWith('/issue')){assert.equal(call.postDataJSON().expectedRevision,entry.revision);entry.state='issued';entry.revision++;return route.fulfill({json:{id:entry.id,revision:entry.revision}});}
  if(path.startsWith('/api/deliveries/'))return route.fulfill({json:{deliveries:[entry],items:[file],recipients:draft.recipients.map(person=>({id:person.id,email:person.email,acceptedAt:null}))}});
  if(path==='/api/delivery/preview'){assert.equal(call.postDataJSON().token,draft.recipients[0].token);return route.fulfill({json:{id:entry.id,title:entry.title,senderName:entry.senderName,fileCount:1,totalBytes:4,expiresAt:entry.expiresAt}});}
  if(path==='/api/delivery/accept'){accepted=true;return route.fulfill({json:{id:entry.id}});}
  if(path===`/api/delivery/${entry?.id}`){assert.equal(accepted,true);return route.fulfill(unavailable?{status:404,json:{error:'This delivery has ended or is unavailable.'}}:{json:{delivery:entry,items:[file]}});}
  if(path.endsWith('/link'))return route.fulfill({json:{url:'/api/generated-original'}});
  if(path.endsWith('/download'))return route.fulfill({status:302,headers:{location:originalUrl}});
  if(path==='/api/generated-original')return route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Reviewed original.txt"'},body:Buffer.from('tiny')});
  throw new Error('Unexpected delivery browser request '+path);
});
try{
  await page.goto(`${origin}/?space=${space}&scope=${scope}`);
  await page.getByRole('checkbox',{name:`Select ${file.name}`,exact:true}).click();
  await page.getByRole('button',{name:'Create delivery',exact:true}).click();
  await page.getByLabel('Delivery title',{exact:true}).fill('Your event originals');
  await page.getByLabel('From, shown to recipients',{exact:true}).fill('Studio public');
  await page.getByLabel('Recipient emails',{exact:true}).fill('recipient@example.test');
  await page.getByRole('button',{name:'Review delivery',exact:true}).click();
  await expect(page.getByText('Source: Client private',{exact:false})).toBeVisible();
  assert.equal(entry.state,'draft');
  await page.getByRole('button',{name:'Publish delivery',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Share this delivery?',exact:true});
  await expect(confirmation).toContainText('recipient@example.test');await expect(confirmation).toContainText('cannot be recalled');
  await confirmation.getByRole('button',{name:'Publish delivery',exact:true}).click();
  const link=await page.getByLabel('Link for recipient@example.test',{exact:true}).inputValue();assert.match(link,/#delivery=[a-f0-9]{64}$/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('outputs/deliveries',{recursive:true});await page.screenshot({path:'outputs/deliveries/sender-mobile.png',fullPage:true});
  mode='recipient';signedIn=false;await page.goto(link);
  await expect(page.getByRole('heading',{name:'Your delivery invitation'})).toBeVisible();await expect.poll(()=>new URL(page.url()).hash).toBe('');
  await page.getByRole('link',{name:'Continue to sign in'}).click();signedIn=true;await page.reload();
  await expect(page.getByText('From Studio public',{exact:true})).toBeVisible();await expect(page.getByText('Secret working studio',{exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Accept and open delivery',exact:true}).click();
  await expect(page.getByRole('heading',{name:file.name,exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Save original',exact:true})).toHaveAttribute('href',`/api/delivery/${entry.id}/${file.id}/download`);
  // Chromium bypasses route interception for native download navigation. Exercise the browser
  // save using the generated HTTP fixture; the real authenticated endpoint is tested in delivery-routes.
  await page.getByRole('link',{name:'Save original',exact:true}).evaluate((anchor,url)=>anchor.href=url,originalUrl);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Save original',exact:true}).click();const download=await downloadPromise;
  assert.equal((await readFile(await download.path())).toString(),'tiny');
  await expect(page.getByRole('status')).toContainText('Download requested');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'outputs/deliveries/recipient-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Download originals',exact:true}).click();
  const packageDialog=page.getByRole('dialog',{name:'Download originals',exact:true});
  const packageDownload=page.waitForEvent('download');await packageDialog.getByRole('button',{name:'Create ZIP',exact:true}).click();
  const archive=await readFile(await (await packageDownload).path());assert.equal(archive.readUInt32LE(0),0x04034b50);
  assert.ok(archive.includes(Buffer.from('Reviewed original.txt')));assert.ok(archive.includes(Buffer.from('tiny')));
  await expect(packageDialog.getByRole('status')).toContainText('download requested');
  await packageDialog.getByRole('button',{name:'Close original package'}).click();

  // A generated in-memory file writer exercises the real verified-save UI without opening a system picker.
  await page.addInitScript(()=>{
    window.deliverySaved=false;
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{window.deliverySaved=true;},abort:async()=>{window.deliverySaved=false;}})})});
  });
  await page.reload();await page.getByRole('button',{name:'Save verified',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Original file verified');assert.equal(await page.evaluate(()=>window.deliverySaved),true);
  await page.getByRole('button',{name:'Download originals',exact:true}).click();
  await packageDialog.getByRole('button',{name:'Create ZIP',exact:true}).click();
  await expect(packageDialog.getByRole('status')).toContainText('Package saved. Every original verified.');
  await packageDialog.getByRole('button',{name:'Close original package'}).click();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'outputs/deliveries/recipient-desktop.png',fullPage:true});
  unavailable=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('alert')).toContainText('unavailable');await expect(page.getByRole('heading',{name:file.name,exact:true})).toHaveCount(0);
  console.log('PASS delivery browser: selected-file review and deliberate issuance, recipient secret handoff, public labels, native/verified save distinction and revoked filename clearing at mobile/desktop widths');
}finally{await browser.close();await new Promise(resolve=>originalServer.close(resolve));}


