import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/account-sessions.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const accounts=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settings={issuer:'https://access.auth0.com/',clientId:'access-test',clientSecret:'isolated-test-only',appOrigin:'https://localhost'};

// Exercise the built production Worker with actual D1, R2, cookies and optional closure admission.
// The recipient receives only captured delivery metadata and exact originals, never source membership.
export async function verifyDeliveryRoutes(db,bucket,dispatch){
  const now=Date.now(),space=crypto.randomUUID(),scope=crypto.randomUUID(),people=[];
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Studio fixture',now).run();
  for(const name of ['Owner','Recipient','Other owner']){
    const subject=crypto.randomUUID(),email=subject+'@example.invalid';
    const login=await accounts.createAccountSession(db,settings,{issuer:settings.issuer,subject,displayName:name,verifiedEmail:email,authenticatedAt:Math.floor(now/1000)*1000,credentialsChangedAt:0},null);
    const session=await accounts.readAccountSession(db,settings,login.token),membership=crypto.randomUUID();
    if(name!=='Recipient')await db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(membership,session.personId,space,now).run();
    people.push({...login,...session,membership,email});
  }
  const [owner,recipient,other]=people;
  const call=async(person,path,method='GET',body,scoped=false,origin=settings.appOrigin)=>{
    const response=await dispatch(`${settings.appOrigin}/api/${path}${scoped?(path.includes('?')?'&':'?')+'space='+space:''}`,{method,headers:{Cookie:`__Host-relay_account=${person.token}`,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  const ownerSession=await call(owner,'session','GET',undefined,true);assert.equal(ownerSession.data.deliveries,true);
  await db.prepare('INSERT INTO asset_scopes VALUES(?,?,?,?,?)').bind(scope,space,'Secret source audience',owner.membership,now).run();
  await db.prepare('INSERT INTO scope_grants VALUES(?,?,?,?,NULL)').bind(scope,owner.membership,owner.personId,now).run();
  const id=crypto.randomUUID(),bytes=new Uint8Array([1,2,3,4]),hash=createHash('sha256').update(bytes).digest('hex'),key=`${space}/${id}/original`;
  await bucket.put(key,bytes);
  await db.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id)
    VALUES(?,?,?,'Reviewed name.bin','application/octet-stream',4,?,'original',?,'fixture',16,'ready',?,?)`).bind(id,space,ownerSession.data.deviceId,hash,key,now,scope).run();
  const alternate='alternate-'+crypto.randomUUID()+'@example.invalid';
  const input={id:crypto.randomUUID(),title:'Reviewed delivery',accessScopeId:scope,files:[{id,revision:0}],expiresAt:now+86400000,
    recipients:[{id:crypto.randomUUID(),email:recipient.email,token:'a'.repeat(64)},{id:crypto.randomUUID(),email:alternate,token:'b'.repeat(64)}],confirmed:true,confirmAudienceExpansion:true};
  assert.equal((await call(owner,'deliveries','POST',input,true,'https://foreign.invalid')).status,403);
  const draft=await call(owner,'deliveries','POST',input,true);assert.equal(draft.status,200,JSON.stringify(draft.data));
  assert.equal((await call(owner,'deliveries','POST',input,true)).status,200);
  assert.equal((await call(recipient,'delivery/accept','POST',{token:input.recipients[0].token})).status,404);
  assert.equal((await call(other,'deliveries','GET',undefined,true)).data.deliveries.length,0);
  assert.equal((await call(other,`deliveries/${input.id}`,'GET',undefined,true)).status,404);
  assert.equal((await call(owner,`deliveries/${input.id}/issue`,'POST',{expectedRevision:0,confirmed:true,confirmAudienceExpansion:true},true)).status,200);
  const preview=await call(recipient,'delivery/preview','POST',{token:input.recipients[0].token});assert.equal(preview.status,200);
  assert.doesNotMatch(JSON.stringify(preview.data),/Secret source|Reviewed name|object_key|token_hash/);
  assert.equal((await call(other,'delivery/accept','POST',{token:input.recipients[0].token})).status,404);
  assert.equal((await call(recipient,'delivery/accept','POST',{token:input.recipients[0].token})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM space_memberships WHERE person_id=?').bind(recipient.personId).first()).n,0);
  assert.equal((await call(recipient,'feed','GET',undefined,true)).status,403);
  const opened=await call(recipient,`delivery/${input.id}`);assert.equal(opened.status,200);assert.equal(opened.data.items.length,1);assert.equal(opened.data.items[0].name,'Reviewed name.bin');
  assert.doesNotMatch(JSON.stringify(opened.data),/object_key|token_hash|Secret source|@example/);
  await db.prepare("UPDATE media SET name='Later working name',revision=1 WHERE id=?").bind(id).run();
  assert.equal((await call(recipient,`delivery/${input.id}`)).data.items[0].name,'Reviewed name.bin');
  await db.prepare('UPDATE people SET verified_email=? WHERE id=?').bind(alternate,recipient.personId).run();
  assert.equal((await call(recipient,'delivery/accept','POST',{token:input.recipients[1].token})).status,200);
  assert.equal((await call(recipient,`delivery/${input.id}`)).data.items.length,1,'Two grants bound to the same person do not duplicate the selection');
  const link=await call(recipient,`delivery/${input.id}/${id}/link`);assert.equal(link.status,200);assert.ok(link.data.expiresAt<=Date.now()+60000);
  const saved=await dispatch(new URL(link.data.url,settings.appOrigin).href,{headers:{Cookie:`__Host-relay_account=${recipient.token}`}});
  assert.equal(saved.status,200);assert.match(saved.headers.get('Content-Disposition'),/Reviewed name/);assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),bytes);
  const nativeSaved=await dispatch(`${settings.appOrigin}/api/delivery/${input.id}/${id}/download`,{headers:{Cookie:`__Host-relay_account=${recipient.token}`}});
  assert.equal(nativeSaved.status,200);assert.match(nativeSaved.headers.get('Content-Disposition'),/Reviewed name/);assert.deepEqual(new Uint8Array(await nativeSaved.arrayBuffer()),bytes);
  await db.prepare('UPDATE media SET archived_at=? WHERE id=?').bind(now,id).run();
  assert.equal((await call(recipient,`delivery/${input.id}`)).status,404);
  assert.equal((await call(recipient,`delivery/${input.id}/${id}/link`)).status,404);
  await db.prepare('UPDATE media SET archived_at=NULL WHERE id=?').bind(id).run();assert.equal((await call(recipient,`delivery/${input.id}`)).status,404);
  assert.equal((await call(owner,`deliveries/${input.id}/issue`,'POST',{expectedRevision:2,confirmed:true,confirmAudienceExpansion:true},true)).status,200);
  assert.equal((await call(recipient,`delivery/${input.id}`)).status,200);
  assert.equal((await call(owner,`deliveries/${input.id}`,'DELETE',{expectedRevision:3,confirmed:true},true)).status,200);
  assert.equal((await call(recipient,`delivery/${input.id}`)).status,404);
  assert.equal((await call(recipient,`media/${id}/link`,'GET',undefined,true)).status,403);
  assert.equal((await db.prepare('SELECT status FROM media WHERE id=?').bind(id).first()).status,'ready');
  console.log('PASS built delivery routes: owner review/issue, exact private snapshot, named-account acceptance without membership, original bytes, duplicate-grant handling, sticky source suspension and explicit reactivation/revocation');
}
