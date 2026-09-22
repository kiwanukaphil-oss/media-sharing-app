import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Execute audience administration against disposable D1, with server-resolved actors.
globalThis.__activityEnv={};
const bundle=await build({entryPoints:['lib/scope-management.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__activityEnv;',loader:'js'}));},
}]});
const modules=await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const {readAccessScopes,createAccessScope,changeScopeGrant}=modules[0];
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'activity-fixture',modules:true,script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
  const db=await runtime.getD1Database('DB');globalThis.__activityEnv.DB=db;
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)
    for(const sql of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  const space=crypto.randomUUID(),file=crypto.randomUUID(),second=crypto.randomUUID(),now=Date.now();
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Activity fixture',now).run();
  const actors=[];
  for(let index=0;index<2;index++) {
    const person=crypto.randomUUID(),member=crypto.randomUUID(),session=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(person,'https://fixture.invalid/',person,'Fixture','fixture@example.invalid',now),
      db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(member,person,space,now),
      db.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,0)').bind(member,space,'Fixture','account-attribution:'+member,now),
      db.prepare('INSERT INTO account_space_actors VALUES(?,?)').bind(member,member),
      db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').bind(session,person,session,'fixture',now,now+3600000,now),
    ]);
    actors.push({id:member,space_id:space,role:'owner',authentication:'account',personId:person,sessionId:session});
  }
  for(const id of [file,second])await db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'photo.jpg','image/jpeg',4,?,'original',?,'complete',4,'ready',?)").bind(id,space,actors[0].id,'a'.repeat(64),space+'/'+id,now).run();
  const owner=actors[0],other=actors[1],scope=crypto.randomUUID();
  const request=body=>new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const input={id:scope,name:'Sensitive collection',members:[owner.id,other.id],confirmAudience:true};
  const created=await (await createAccessScope(request(input),owner)).json();
  assert.equal(created.created,true);
  const retry=await (await createAccessScope(request(input),owner)).json();
  assert.equal(retry.created,false);assert.equal(retry.scope.version,created.scope.version);
  assert.equal((await readAccessScopes(other)).scopes[0].name,input.name);
  const revoke=await (await changeScopeGrant(request({membershipId:other.id,version:created.scope.version,grant:false,confirmAudience:true}),owner,scope)).json();
  assert.equal((await readAccessScopes(other)).scopes.length,0);
  const catalog=await readAccessScopes(other,true);
  assert.equal(catalog.scopes.length,1);assert.equal(JSON.stringify(catalog).includes(input.name),false,'Owner catalog does not expose restricted names.');
  await assert.rejects(changeScopeGrant(request({membershipId:other.id,version:created.scope.version,grant:true,confirmAudience:true}),owner,scope),e=>e.status===409);
  await assert.rejects(changeScopeGrant(request({membershipId:other.id,version:revoke.version,grant:true,confirmAudience:true}),other,scope),e=>e.status===400,'Administrator self-access requires distinct confirmation.');
  const granted=await (await changeScopeGrant(request({membershipId:other.id,version:revoke.version,grant:true,confirmAudience:true,confirmAdministratorAccess:true}),other,scope)).json();
  assert.equal((await db.prepare('SELECT action FROM asset_scope_events WHERE id=?').bind(granted.version).first()).action,'administrator-grant');
  await db.prepare("UPDATE space_memberships SET role='editor' WHERE id=?").bind(other.id).run();
  await assert.rejects(readAccessScopes(other,true),e=>e.status===403,'Cached owner role cannot administer.');
  assert.equal((await readAccessScopes(other)).scopes.length,1,'Role change retains granted browsing.');
  await assert.rejects(createAccessScope(request({...input,id:crypto.randomUUID()}),other),e=>e.status===409);
  await assert.rejects(createAccessScope(request({...input,id:crypto.randomUUID(),members:[owner.id,crypto.randomUUID()]}),owner),e=>e.status===409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM asset_scopes').first()).n,1,'Invalid memberships create no partial scope.');
  await db.prepare("CREATE TRIGGER deny_scope_audit BEFORE INSERT ON asset_scope_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
  await assert.rejects(changeScopeGrant(request({membershipId:other.id,version:granted.version,grant:false,confirmAudience:true}),owner,scope));
  assert.equal((await db.prepare('SELECT revoked_at FROM scope_grants WHERE scope_id=? AND membership_id=?').bind(scope,other.id).first()).revoked_at,null,'Failed audit rolls back grant mutation.');
  console.log('PASS: atomic audience creation, exact-member validation, stable retries, opaque owner catalog, stale versions/roles, explicit audited administrator access and audit rollback. Production activation remains disabled.');
} finally {await runtime.dispose();delete globalThis.__activityEnv;}
