import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/account-sessions.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const accounts=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settings={issuer:'https://access.auth0.com/',clientId:'access-test',clientSecret:'isolated-test-only',appOrigin:'https://localhost'};

// Exercise the real built Worker, D1/R2, account cookies and closure tracking. Fixture recipient has
// no space membership: successful collection must not create one or expose existing restricted files.
export async function verifyIntakeRoutes(db,bucket,dispatch,paused=false){
  const now=Date.now(),space=crypto.randomUUID(),scope=crypto.randomUUID(),people=[];
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Receiving fixture',now).run();
  for(const name of ['Owner','Recipient','Other owner']){
    const subject=crypto.randomUUID(),email=subject+'@example.invalid';
    const login=await accounts.createAccountSession(db,settings,{issuer:settings.issuer,subject,displayName:name,verifiedEmail:email,authenticatedAt:Math.floor(now/1000)*1000,credentialsChangedAt:0},null);
    const session=await accounts.readAccountSession(db,settings,login.token),membership=crypto.randomUUID();
    if(name!=='Recipient')await db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(membership,session.personId,space,now).run();
    people.push({...login,...session,membership,email});
  }
  const [owner,recipient,other]=people;
  const call=async(person,path,method='GET',body,scoped=false,origin=settings.appOrigin)=>{
    const response=await dispatch(`${settings.appOrigin}/api/${path}${scoped?(path.includes('?')?'&':'?')+'space='+space:''}`,{method,
      headers:{Cookie:`__Host-relay_account=${person.token}`,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await call(owner,'session','GET',undefined,true)).data.uploadRequests,true);
  await db.prepare('INSERT INTO asset_scopes VALUES(?,?,?,?,?)').bind(scope,space,'Private destination',owner.membership,now).run();
  await db.prepare('INSERT INTO scope_grants VALUES(?,?,?,?,NULL)').bind(scope,owner.membership,owner.personId,now).run();
  const album=await call(owner,'albums','POST',{name:'Hidden album',description:'',accessScopeId:scope},true);assert.equal(album.status,200);
  const input={id:crypto.randomUUID(),token:'a'.repeat(64),title:'Send selected photos',recipientEmail:recipient.email,albumId:album.data.id,sectionId:null,accessScopeId:scope,expiresAt:now+86400000,maxFiles:2,maxFileBytes:8,maxBytes:16,confirmed:true};
  assert.equal((await call(owner,'upload-requests','POST',input,true,'https://foreign.invalid')).status,403);
  if(paused){
    assert.equal((await call(owner,'upload-requests','POST',input,true)).status,503);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM upload_requests').first()).n,0);
    // Seed previously admitted generated work through the tested core helpers, bypassing only the
    // new route-level pause to model an incident occurring after reservation, without real storage.
    const preparation=await build({entryPoints:['lib/upload-request-management.ts','lib/upload-request-reservations.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm'});
    const modules=await Promise.all(preparation.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
    const management=modules.find(module=>module.createUploadRequestDraft),reservations=modules.find(module=>module.activateUploadRequest);
    const actor=(await call(owner,'session','GET',undefined,true)).data.deviceId;
    const authority={...owner,id:actor,space_id:space,space_kind:'shared',role:'owner',authentication:'account'};
    await management.createUploadRequestDraft(db,authority,{...input,tokenHash:createHash('sha256').update(input.token).digest('hex')});
    await reservations.activateUploadRequest(db,authority,input.id,1024);
    await db.prepare('UPDATE upload_requests SET accepted_by=?,accepted_at=? WHERE id=?').bind(recipient.personId,now,input.id).run();
    const file={id:crypto.randomUUID(),requestId:input.id,name:'Retained fixture',mime:'application/octet-stream',size:4,sha256:'a'.repeat(64)};
    await reservations.reserveIntakeSubmission(db,recipient,file);
    assert.equal((await call(recipient,'intake/preview','POST',{token:input.token})).status,200);
    for(const [path,body] of [['intake/accept',{token:input.token}],['intake/uploads',file],[`intake/uploads/${file.id}/part`,{partNumber:1}],[`intake/uploads/${file.id}/complete`,{parts:[]}]])assert.equal((await call(recipient,path,'POST',body)).status,503);
    const receipt=await call(recipient,`intake/requests/${input.id}`);assert.equal(receipt.status,200);assert.equal(receipt.data.paused,true);assert.equal(receipt.data.receipts[0].phase,'reserved');
    const review=await call(owner,`upload-requests/${input.id}`,'GET',undefined,true);assert.equal(review.status,200);assert.equal(review.data.paused,true);
    assert.equal((await call(owner,`upload-requests/${input.id}`,'DELETE',{expectedRevision:review.data.requests[0].revision},true)).status,200);
    assert.equal((await db.prepare('SELECT size FROM media WHERE id=?').bind(file.id).first()).size,4);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM intake_upload_attempts').first()).n,0);
    console.log('PASS intake admission pause: no new grants/reservations/capabilities/completion, retained receipts, owner review/close and staged capacity preserved');return;
  }

  const created=await call(owner,'upload-requests','POST',input,true);assert.equal(created.status,200,JSON.stringify(created.data));
  assert.equal((await call(owner,'upload-requests','POST',input,true)).status,200);
  assert.equal((await call(other,'upload-requests','GET',undefined,true)).data.requests.length,0);
  assert.equal((await call(other,`upload-requests/${input.id}`,'GET',undefined,true)).status,404);
  const preview=await call(recipient,'intake/preview','POST',{token:input.token});assert.equal(preview.status,200,JSON.stringify(preview.data));
  assert.equal(preview.data.title,input.title);assert.doesNotMatch(JSON.stringify(preview.data),/Hidden album|Private destination|token_hash|object_key/);
  assert.equal((await call(other,'intake/accept','POST',{token:input.token})).status,404);
  assert.equal((await call(recipient,'intake/accept','POST',{token:input.token},false,'https://foreign.invalid')).status,403);
  assert.equal((await call(recipient,'intake/accept','POST',{token:input.token})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE person_id=?').bind(recipient.personId).first()).n,0);
  assert.equal((await call(recipient,'feed','GET',undefined,true)).status,403);
  const bytes=new Uint8Array([1,2,3,4]),file={id:crypto.randomUUID(),requestId:input.id,name:'Submitted original.bin',mime:'application/octet-stream',size:4,sha256:createHash('sha256').update(bytes).digest('hex')};
  const upload=await call(recipient,'intake/uploads','POST',file);assert.equal(upload.status,200,JSON.stringify(upload.data));
  assert.equal((await call(owner,'feed?scope='+scope,'GET',undefined,true)).data.total,0);
  const capability=await call(recipient,`intake/uploads/${file.id}/part`,'POST',{number:1});assert.equal(capability.status,200,JSON.stringify(capability.data));
  assert.ok(capability.data.expiresAt<=Date.now()+60000);assert.equal(capability.data.objectKey,undefined);
  const sent=await dispatch(new URL(capability.data.url,settings.appOrigin).href,{method:'PUT',headers:{Cookie:`__Host-relay_account=${recipient.token}`,Origin:settings.appOrigin,'Content-Length':'4'},body:bytes});
  assert.equal(sent.status,200);const part=await sent.json();
  const completed=await call(recipient,`intake/uploads/${file.id}/complete`,'POST',{parts:[part]});assert.equal(completed.status,200,JSON.stringify(completed.data));assert.equal(completed.data.verified,false);
  assert.equal((await call(owner,'feed?scope='+scope,'GET',undefined,true)).data.total,0);
  const review=await call(owner,`upload-requests/${input.id}`,'GET',undefined,true);assert.equal(review.data.submissions[0].phase,'received');assert.doesNotMatch(JSON.stringify(review.data),/object_key|upload_id|token_hash/);
  const downloadPath=`${settings.appOrigin}/api/upload-requests/${input.id}/original?file=${file.id}&space=${space}`;
  const deniedDownload=await dispatch(downloadPath,{headers:{Cookie:`__Host-relay_account=${other.token}`}});assert.equal(deniedDownload.status,404);await deniedDownload.arrayBuffer();
  const downloaded=await dispatch(downloadPath,{headers:{Cookie:`__Host-relay_account=${owner.token}`}});
  assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('Content-Type'),'application/octet-stream');assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
  assert.equal((await call(owner,'feed?scope='+scope,'GET',undefined,true)).data.total,0,'Review download must not publish');
  assert.equal((await call(owner,`upload-requests/${input.id}/decline`,'POST',{fileId:file.id,confirmed:true},true)).status,200);
  assert.equal((await call(recipient,`intake/requests/${input.id}`)).data.receipts[0].phase,'rejected');
  assert.equal((await call(owner,`upload-requests/${input.id}/accept`,'POST',{fileId:file.id,confirmed:true},true)).status,404);
  assert.equal((await call(owner,`upload-requests/${input.id}/restore`,'POST',{fileId:file.id,confirmed:true},true)).status,200);
  assert.equal((await call(owner,`upload-requests/${input.id}/restore`,'POST',{fileId:file.id,confirmed:true},true)).status,200);
  const accepted=await call(owner,`upload-requests/${input.id}/accept`,'POST',{fileId:file.id,confirmed:true},true);assert.equal(accepted.status,200,JSON.stringify(accepted.data));
  assert.equal((await call(owner,'feed?scope='+scope,'GET',undefined,true)).data.total,1);
  assert.equal((await call(recipient,`media/${file.id}/download`,'GET',undefined,true)).status,403);
  assert.equal((await call(recipient,`intake/uploads/${file.id}/download`)).status,404);
  const receipt=await call(recipient,`intake/requests/${input.id}`);assert.equal(receipt.data.receipts[0].phase,'accepted');assert.equal(receipt.data.request.remainingBytes,12);
  const row=await db.prepare('SELECT object_key FROM media WHERE id=?').bind(file.id).first();assert.deepEqual(new Uint8Array(await (await bucket.get(row.object_key)).arrayBuffer()),bytes);
  const latest=await call(owner,`upload-requests/${input.id}`,'GET',undefined,true);
  assert.equal((await call(owner,`upload-requests/${input.id}`,'DELETE',{expectedRevision:latest.data.requests[0].revision},true)).status,200);
  assert.equal((await call(recipient,`intake/requests/${input.id}`)).status,404);
  assert.equal((await db.prepare('SELECT status FROM media WHERE id=?').bind(file.id).first()).status,'ready');
  console.log('PASS: built Worker recipient-only intake, explicit private destination, CSRF, no membership/disclosure, bounded capability custody, multipart receipt, independent owner acceptance, retained original and request closure.');
}
