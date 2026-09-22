import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/account-sessions.ts','lib/publications.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm'});
const modules=await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const accounts=modules.find(module=>module.createAccountSession),publications=modules.find(module=>module.reservePublication);
const settings={issuer:'https://access.auth0.com/',clientId:'access-test',clientSecret:'isolated-test-only',appOrigin:'https://localhost'};

// Test the built Worker, real D1/R2 and account cookies. All people, bytes and grants are disposable
// local fixtures; the activation flag is supplied only by this explicit integration mode.
export async function verifyRestrictedRoutes(db,bucket,dispatch) {
  const space=crypto.randomUUID(),scope=crypto.randomUUID(),now=Date.now(),people=[];
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Restricted route fixture',now).run();
  for(const role of ['owner','owner','viewer']) {
    const subject=crypto.randomUUID(),login=await accounts.createAccountSession(db,settings,{issuer:settings.issuer,subject,displayName:role,authenticatedAt:Math.floor(now/1000)*1000,credentialsChangedAt:0,verifiedEmail:subject+'@example.invalid'},null);
    const session=await accounts.readAccountSession(db,settings,login.token),member=crypto.randomUUID();
    await db.prepare('INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,?,?)').bind(member,session.personId,space,role,now).run();
    people.push({...login,...session,member});
  }
  const request=async(person,path,method='GET',body,origin=settings.appOrigin)=>{
    const response=await dispatch(`https://localhost/api/${path}${path.includes('?')?'&':'?'}space=${space}`,{method,headers:{Cookie:`__Host-relay_account=${person.token}`,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  const [owner,ungranted,viewer]=people;
  assert.equal((await request(owner,'session')).data.restrictedScopes,true);
  const initial={id:scope,name:'Restricted route audience',members:[owner.member,viewer.member],confirmAudience:true};
  assert.equal((await request(owner,'access-scopes','POST',initial,'https://foreign.invalid')).status,403);
  const created=await request(owner,'access-scopes','POST',initial);assert.equal(created.status,200,JSON.stringify(created.data));
  const album=await request(owner,'albums','POST',{name:'Secret album',description:'',accessScopeId:scope});assert.equal(album.status,200);
  const file=crypto.randomUUID(),key=`${space}/${file}/original`,bytes=new Uint8Array([1,2,3,4]);
  await bucket.put(key,bytes);
  await db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id) VALUES(?,?,?,'Secret original.bin','application/octet-stream',4,?,'original',?,'complete',4,'ready',?,?)").bind(file,space,owner.member,createHash('sha256').update(bytes).digest('hex'),key,now,scope).run();
  await db.prepare('INSERT INTO album_media(album_id,media_id) VALUES(?,?)').bind(album.data.id,file).run();
  for(const person of people)assert.equal((await request(person,'feed')).data.total,0,'General browsing excludes restricted assets.');
  assert.equal((await request(owner,'feed?scope='+scope)).data.total,1);
  assert.equal((await request(viewer,'feed?scope=accessible')).data.total,1);
  assert.equal((await request(ungranted,'feed?scope=accessible')).data.total,0);
  const catalog=await request(ungranted,'access-scopes?administration=1');assert.equal(catalog.status,200);
  assert.equal(JSON.stringify(catalog.data).includes('Restricted route audience'),false);
  for(const path of [`media/${file}/link`,`media/${file}/download`,`media/${file}/thumbnail`,`sections?album=${album.data.id}`])assert.equal((await request(ungranted,path)).status,404,path);
  assert.equal((await request(ungranted,'metadata-export','POST',{files:[{id:file,expectedRevision:0}]})).status,409);
  assert.equal((await request(viewer,'library/rename','POST',{files:[{id:file,name:'Changed.bin',expectedRevision:0}]})).status,403);
  const download=await dispatch(`https://localhost/api/media/${file}/download?space=${space}`,{headers:{Cookie:`__Host-relay_account=${viewer.token}`}});
  assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),bytes);
  // Each explicit audience crossing creates independently verified bytes and leaves its source intact.
  const copy={id:crypto.randomUUID(),sourceId:file,sourceRevision:0,sourceScopeId:scope,destinationScopeId:null,confirmed:true};
  assert.equal((await request(viewer,'scope-copies','POST',copy)).status,403);
  assert.equal((await request(ungranted,'scope-copies','POST',copy)).status,409);
  assert.equal((await request(owner,'scope-copies','POST',{...copy,confirmed:false})).status,400);
  assert.equal((await request(owner,'scope-copies','POST',{...copy,destinationScopeId:scope})).status,403);
  assert.equal((await request(owner,'scope-copies','POST',{...copy,albumId:album.data.id})).status,409);
  assert.equal((await request(owner,'scope-copies','POST',{...copy,sourceRevision:1})).status,409);
  const copied=await request(owner,'scope-copies','POST',copy);assert.equal(copied.status,200,JSON.stringify(copied.data));
  assert.equal((await request(owner,'scope-copies','POST',copy)).status,200,'Lost-response retry reuses the same copy.');
  const copiedRow=await db.prepare('SELECT object_key,access_scope_id FROM media WHERE id=?').bind(copy.id).first();
  assert.equal(copiedRow.access_scope_id,null);assert.notEqual(copiedRow.object_key,key);
  assert.deepEqual(new Uint8Array(await (await bucket.get(copiedRow.object_key)).arrayBuffer()),bytes);
  assert.deepEqual(new Uint8Array(await (await bucket.get(key)).arrayBuffer()),bytes);
  assert.equal((await request(ungranted,'feed')).data.total,1);
  const history=await db.prepare("SELECT resources,scope_ids FROM library_events WHERE action='file.arrive' AND resources LIKE ?").bind('%'+copy.id+'%').all();
  assert.equal(history.results.length,1);assert.equal(history.results[0].scope_ids,'[null]');assert.equal(history.results[0].resources.includes(file),false);
  const privateCopy={...copy,id:crypto.randomUUID(),sourceId:copy.id,sourceScopeId:null,destinationScopeId:scope,albumId:album.data.id};
  assert.equal((await request(ungranted,'scope-copies','POST',privateCopy)).status,409,'Destination grant is independently required.');
  assert.equal((await request(owner,'scope-copies','POST',privateCopy)).status,200);
  assert.equal((await request(owner,'feed?scope='+scope)).data.total,2);
  assert.equal((await request(ungranted,'feed')).data.total,1,'A restricted copy never recalls a general source.');
  assert.equal((await request(owner,'scope-copies?sourceId='+file)).data.publication.id,copy.id);
  const upload=await request(owner,'uploads','POST',{id:crypto.randomUUID(),name:'Scoped unfinished.bin',mime:'application/octet-stream',size:4,sha256:'b'.repeat(64),category:'original',accessScopeId:scope});assert.equal(upload.status,200);
  const revoke=await request(owner,`access-scopes/${scope}`,'PUT',{membershipId:owner.member,version:created.data.scope.version,grant:false,confirmAudience:true});assert.equal(revoke.status,200);
  assert.equal((await request(owner,`uploads/${upload.data.id}/part`,'POST',{number:1})).status,404,'Revocation prevents a new multipart capability.');
  assert.equal((await request(owner,`media/${file}/link`)).status,404);
  assert.equal((await request(owner,'scope-copies','POST',copy)).status,409);
  assert.equal((await request(owner,'scope-copies?sourceId='+file)).status,404);
  assert.equal((await request(ungranted,'feed')).data.total,1);
  const selfGrant={membershipId:owner.member,version:revoke.data.version,grant:true,confirmAudience:true};
  assert.equal((await request(owner,`access-scopes/${scope}`,'PUT',selfGrant)).status,400);
  const granted=await request(owner,`access-scopes/${scope}`,'PUT',{...selfGrant,confirmAdministratorAccess:true});assert.equal(granted.status,200);
  assert.equal((await db.prepare('SELECT action FROM asset_scope_events WHERE id=?').bind(granted.data.version).first()).action,'administrator-grant');
  // Inject a grant loss after R2 accepts the bytes but before the actual D1 visibility commit.
  const current=(await request(owner,'session')).data;
  const access={id:current.deviceId,space_id:space,space_name:'Fixture',name:'Owner',role:'owner',authentication:'account',space_kind:'shared',sessionId:owner.sessionId,personId:owner.personId};
  const racing={...copy,id:crypto.randomUUID(),destinationSpaceId:space};
  const job=await publications.reservePublication(db,access,access,racing,1073741824);
  let attemptKey;
  const racingBucket={get:key=>bucket.get(key),delete:keys=>bucket.delete(keys),put:async(key,body,options)=>{
// The Node bridge loses stream-length metadata; buffer only this four-byte local test fixture.
    const result=await bucket.put(key,await new Response(body).arrayBuffer(),options);attemptKey=key;
    await db.prepare('UPDATE scope_grants SET revoked_at=? WHERE scope_id=? AND membership_id=?').bind(Date.now(),scope,owner.member).run();return result;
  }};
  await assert.rejects(publications.finishPublication(db,racingBucket,access,job),/Access or the destination changed/);
  assert.equal((await db.prepare('SELECT status FROM media WHERE id=?').bind(racing.id).first()).status,'publishing');
  assert.equal(await bucket.get(attemptKey),null,'A failed visibility commit cleans only its generated attempt.');
  assert.deepEqual(new Uint8Array(await (await bucket.get(key)).arrayBuffer()),bytes);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM library_events WHERE action='file.arrive' AND resources LIKE ?").bind('%'+racing.id+'%').first()).n,0);
  // The general destination remains cancellable by its owner even after source access is lost.
  await publications.cancelPublication(db,bucket,access,racing.id);
  assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(racing.id).first(),null);
  console.log('PASS: cross-audience copy bytes, exact retry, recovery, source/destination grant denial, independent source, destination-only history and grant-loss commit rollback.');
  console.log('PASS: built Worker audience flag, CSRF, explicit creation, restricted albums/files/bytes, owner-without-grant denial, Viewer capability limits, multipart revocation and audited self-access.');
}
