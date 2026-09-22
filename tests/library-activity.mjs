import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Execute the real library mutations against disposable D1, with server-resolved actors.
globalThis.__activityEnv={};
const bundle=await build({entryPoints:['lib/web-api.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__activityEnv;',loader:'js'}));},
}]});
const {webAction}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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
  const action = async (actor,resource,id,body,method='POST') => webAction(new Request('https://fixture.invalid/api', { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }),actor,resource,id,undefined,{});
  const history = async (actor,query='') => (await webAction(new Request('https://fixture.invalid/api/activity'+query),actor,'activity',undefined,undefined,{})).json();
  const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM library_events').first()).n;
  const owner=actors[0];
  assert.equal((await history(owner)).events.length,0,'Migration invents no historical changes.');
  await action(owner,'library','rename',{files:[{id:file,name:'renamed.jpg',expectedRevision:0}]});
  assert.equal(await count(),1);
  let recent=await history(owner);
  assert.equal(recent.events[0].action,'file.rename'); assert.equal(recent.events[0].actor,'You');
  assert.equal(recent.events[0].changedSince,0);
  assert.equal(JSON.stringify(recent).includes('renamed.jpg'),false);
  assert.equal(JSON.stringify(recent).includes(file),false,'API never exposes resource references.');
  await assert.rejects(action(owner,'library','rename',{files:[{id:file,name:'stale.jpg',expectedRevision:0}]}),e=>e.status===409);
  assert.equal(await count(),1,'Conflict is not a successful event.');
  await action(owner,'library','capture-date',{id:file,capturedAt:'2025-01-01T00:00:00',expectedRevision:1});
  assert.equal(await count(),2);
  recent=await history(owner);assert.equal(recent.events.find(e=>e.action==='file.rename').changedSince,1);
  await action(owner,'library','organise',{files:[{id:file,expectedRevision:2}],action:'trash'});
  await action(owner,'library','organise',{files:[{id:file,expectedRevision:3}],action:'restore'});
  const album=(await (await action(owner,'albums',undefined,{name:'Album',description:''})).json()).id;
  await action(owner,'library','organise',{files:[{id:file,expectedRevision:4}],action:'add',albumId:album});
  await action(owner,'sections',undefined,{albumId:album,expectedRevision:0,name:'Section'});
  assert.equal(await count(),7);
  await assert.rejects(action(owner,'sections',undefined,{albumId:album,expectedRevision:0,name:'Stale'}),e=>e.status===409);
  assert.equal(await count(),7);
  // Force the event insert to fail after the real mutation: D1 batch must roll back the filename too.
  await db.prepare("CREATE TRIGGER reject_fixture_event BEFORE INSERT ON library_events BEGIN SELECT RAISE(ABORT,'fixture rejection'); END").run();
  await assert.rejects(action(owner,'library','rename',{files:[{id:file,name:'rollback.jpg',expectedRevision:5}]}));
  assert.equal((await db.prepare('SELECT name,revision FROM media WHERE id=?').bind(file).first()).name,'renamed.jpg');
  assert.equal(await count(),7);
  await db.prepare('DROP TRIGGER reject_fixture_event').run();
  await db.prepare("UPDATE space_memberships SET role='viewer' WHERE id=?").bind(actors[1].id).run();
  assert.equal((await history({...actors[1],role:'viewer'})).events.length,7);
  await assert.rejects(action(actors[1],'library','rename',{files:[{id:file,name:'denied.jpg',expectedRevision:5}]}),e=>e.status===409);
  assert.equal(await count(),7,'Stale owner role cannot create an event.');
  await action(owner,'library','organise',{files:[{id:second,expectedRevision:0}],action:'trash'});
  await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),owner,'media',second,undefined,{delete:async()=>{throw new Error('storage unavailable');}}));
  assert.equal((await history(owner)).events.some(e=>e.action==='file.delete'),false,'Failed storage cleanup is never reported as permanent deletion.');
  await webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),owner,'media',second,undefined,{delete:async()=>{}});
  assert.equal((await history(owner)).events.filter(e=>e.action==='file.delete').length,1);
  await assert.rejects(history({...owner,space_id:crypto.randomUUID()}),e=>e.status===403);
  await db.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(now,owner.sessionId).run();
  await assert.rejects(history(owner),e=>e.status===403);
  await assert.rejects(history(actors[1],'?before=invalid'),e=>e.status===400);
  // Cursor ordering remains stable for events with exactly the same timestamp.
  const viewer={...actors[1],role:'viewer'};
  for(let i=0;i<35;i++)await db.prepare("INSERT INTO library_events VALUES(?,?,?,'file.arrive',?,1,?)").bind(crypto.randomUUID(),space,owner.id,JSON.stringify([{kind:'media',id:second,revision:0}]),now+5000).run();
  const first=await history(viewer),next=await history(viewer,'?before='+encodeURIComponent(first.next));
  assert.equal(first.events.length,30);assert.equal(next.events.length,14);assert.equal(new Set([...first.events,...next.events].map(e=>e.id)).size,44);
  console.log('PASS: real mutations record atomic scoped activity; conflicts, event failure rollback, Viewer reads, stale authority, revocation, private references and cursor boundaries.');
} finally { await runtime.dispose(); delete globalThis.__activityEnv; }
