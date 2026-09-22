import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Execute the real bookmark/feed helpers against disposable D1, with server-resolved Viewer actors.
globalThis.__metadataEnv={};
const bundle=await build({entryPoints:['lib/web-api.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__metadataEnv;',loader:'js'}));},
}]});
const {webAction}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'metadata-fixture',modules:true,script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
  const db=await runtime.getD1Database('DB');globalThis.__metadataEnv.DB=db;
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)
    for(const sql of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  const space=crypto.randomUUID(),file=crypto.randomUUID(),second=crypto.randomUUID(),now=Date.now();
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Private bookmarks fixture',now).run();
  const actors=[];
  for(let index=0;index<2;index++) {
    const person=crypto.randomUUID(),member=crypto.randomUUID(),session=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(person,'https://fixture.invalid/',person,'Fixture','fixture@example.invalid',now),
      db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'viewer',?)").bind(member,person,space,now),
      db.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,0)').bind(member,space,'Fixture','account-attribution:'+member,now),
      db.prepare('INSERT INTO account_space_actors VALUES(?,?)').bind(member,member),
      db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').bind(session,person,session,'fixture',now,now+3600000,now),
    ]);
    actors.push({id:member,space_id:space,role:'viewer',authentication:'account',personId:person,sessionId:session});
  }
  for(const id of [file,second])await db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'photo.jpg','image/jpeg',4,?,'original',?,'complete',4,'ready',?)").bind(id,space,actors[0].id,'a'.repeat(64),space+'/'+id,now).run();
  const candidates=async(actor,id=file,expectedRevision=0)=>(await webAction(new Request('https://fixture.invalid/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,expectedRevision})}),actor,'duplicate-candidates',undefined,undefined,{})).json();
  assert.deepEqual((await candidates(actors[0])).candidates.map(row=>row.id),[second]);
  assert.equal((await candidates(actors[0])).evidence,'recorded-fingerprint-match');
  assert.doesNotMatch(JSON.stringify(await candidates(actors[0])),/object_key|token_hash|verified_email/);
  await assert.rejects(candidates(actors[0],file,1),e=>e.status===409);
  await assert.rejects(candidates(actors[0],crypto.randomUUID()),e=>e.status===409);
  const scope=crypto.randomUUID();
  await db.prepare('INSERT INTO asset_scopes VALUES(?,?,?,?,?)').bind(scope,space,'Hidden audience',actors[0].id,now).run();
  const privateFile=crypto.randomUUID(),privateTwin=crypto.randomUUID();
  for(const id of [privateFile,privateTwin])await db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id) VALUES(?,?,?,'Private original','image/jpeg',4,?,'original',?,'complete',4,'ready',?,?)").bind(id,space,actors[0].id,'a'.repeat(64),space+'/'+id,now,scope).run();
  assert.equal((await candidates(actors[0])).candidates.length,1,'Same hash in restricted content never leaks to a general lookup.');
  await assert.rejects(candidates(actors[0],privateFile),e=>e.status===409);
  await db.prepare('INSERT INTO scope_grants VALUES(?,?,?,?,NULL)').bind(scope,actors[0].id,actors[0].personId,now).run();
  assert.equal((await candidates(actors[0])).candidates.length,1,'Even a granted combined reader stays within the source audience.');
  assert.deepEqual((await candidates(actors[0],privateFile)).candidates.map(row=>row.id),[privateTwin]);
  await assert.rejects(candidates(actors[1],privateFile),e=>e.status===409);
  await db.prepare('UPDATE media SET archived_at=1 WHERE id=?').bind(second).run();assert.equal((await candidates(actors[0])).candidates.length,0);
  await db.prepare('UPDATE media SET archived_at=NULL WHERE id=?').bind(second).run();
  await db.prepare('UPDATE scope_grants SET revoked_at=? WHERE scope_id=?').bind(now,scope).run();await assert.rejects(candidates(actors[0],privateFile),e=>e.status===409);
  await db.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(now,actors[0].sessionId).run();await assert.rejects(candidates(actors[0]),e=>e.status===409);
  assert.equal((await candidates(actors[1])).candidates.length,1);
  await assert.rejects(candidates({...actors[1],space_id:crypto.randomUUID()}),e=>e.status===409);
  await db.batch(Array.from({length:55},()=>{const id=crypto.randomUUID();return db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'Additional original','image/jpeg',4,?,'original',?,'complete',4,'ready',?)").bind(id,space,actors[0].id,'a'.repeat(64),space+'/'+id,now);}));
  const bounded=await candidates(actors[1]);assert.equal(bounded.candidates.length,50);assert.equal(bounded.hasMore,true);
  const plan=await db.prepare("EXPLAIN QUERY PLAN SELECT id FROM media WHERE space_id=? AND access_scope_id IS NULL AND sha256=? AND size=4 AND status='ready' AND archived_at IS NULL ORDER BY id LIMIT 51").bind(space,'a'.repeat(64)).all();assert.match(JSON.stringify(plan.results),/idx_media_duplicate_candidates/);
  console.log('PASS duplicate candidates: source revision, exact audience, granted-reader isolation, hidden/trashed candidates, revoked scope/session, no source keys or cross-space hash probe');
} finally { await runtime.dispose(); delete globalThis.__metadataEnv; }
