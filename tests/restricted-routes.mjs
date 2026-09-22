import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/account-sessions.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const accounts=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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
  await db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id) VALUES(?,?,?,'Secret original.bin','application/octet-stream',4,?,'original',?,'complete',4,'ready',?,?)").bind(file,space,owner.member,'a'.repeat(64),key,now,scope).run();
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
  const upload=await request(owner,'uploads','POST',{id:crypto.randomUUID(),name:'Scoped unfinished.bin',mime:'application/octet-stream',size:4,sha256:'b'.repeat(64),category:'original',accessScopeId:scope});assert.equal(upload.status,200);
  const revoke=await request(owner,`access-scopes/${scope}`,'PUT',{membershipId:owner.member,version:created.data.scope.version,grant:false,confirmAudience:true});assert.equal(revoke.status,200);
  assert.equal((await request(owner,`uploads/${upload.data.id}/part`,'POST',{number:1})).status,404,'Revocation prevents a new multipart capability.');
  assert.equal((await request(owner,`media/${file}/link`)).status,404);
  const selfGrant={membershipId:owner.member,version:revoke.data.version,grant:true,confirmAudience:true};
  assert.equal((await request(owner,`access-scopes/${scope}`,'PUT',selfGrant)).status,400);
  const granted=await request(owner,`access-scopes/${scope}`,'PUT',{...selfGrant,confirmAdministratorAccess:true});assert.equal(granted.status,200);
  assert.equal((await db.prepare('SELECT action FROM asset_scope_events WHERE id=?').bind(granted.data.version).first()).action,'administrator-grant');
  console.log('PASS: built Worker audience flag, CSRF, explicit creation, restricted albums/files/bytes, owner-without-grant denial, Viewer capability limits, multipart revocation and audited self-access.');
}
