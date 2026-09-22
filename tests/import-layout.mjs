import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Execute the real library mutations against disposable D1, with server-resolved actors.
globalThis.__importEnv={};
const bundle=await build({entryPoints:['lib/web-api.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__importEnv;',loader:'js'}));},
}]});
const {webAction}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'import-fixture',modules:true,script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
  const db=await runtime.getD1Database('DB');globalThis.__importEnv.DB=db;
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
  const input={id:crypto.randomUUID(),name:'New folder album',sections:[{id:crypto.randomUUID(),name:'Originals'},{id:crypto.randomUUID(),name:'Edits / Day 1'}]};
  const create=async(actor,body=input)=>(await webAction(new Request('https://fixture.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),actor,'import-layout',undefined,undefined,{})).json();
  const [first,retry]=await Promise.all([create(actors[0]),create(actors[0])]);
  assert.equal(first.album.id,input.id);assert.deepEqual(first,retry);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM albums').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM album_sections').first()).n,2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM library_events').first()).n,1,'Concurrent retries create one layout/event.');
  await assert.rejects(create(actors[1]),e=>e.status===409,'Another organiser cannot adopt this preview ID.');
  await assert.rejects(create(actors[0],{...input,name:'Changed preview'}),e=>e.status===409);
  assert.equal((await db.prepare('SELECT name FROM albums WHERE id=?').bind(input.id).first()).name,input.name);
  await assert.rejects(create(actors[0],{...input,id:crypto.randomUUID(),sections:[input.sections[0],{id:crypto.randomUUID(),name:'ORIGINALS'}]}),e=>e.status===400);
  await db.prepare("CREATE TRIGGER reject_fixture_section BEFORE INSERT ON album_sections BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
  const rollbackId=crypto.randomUUID();await assert.rejects(create(actors[0],{...input,id:rollbackId}));
  assert.equal(await db.prepare('SELECT id FROM albums WHERE id=?').bind(rollbackId).first(),null,'Failed section creation rolls back album and event.');
  await db.prepare('DROP TRIGGER reject_fixture_section').run();
  await db.prepare("UPDATE space_memberships SET role='editor' WHERE id=?").bind(actors[0].id).run();
  assert.equal((await create({...actors[0],role:'editor'})).album.id,input.id);
  await db.prepare("UPDATE space_memberships SET role='viewer' WHERE id=?").bind(actors[0].id).run();
  await assert.rejects(create(actors[0],{...input,id:crypto.randomUUID()}),e=>e.status===409);
  await assert.rejects(create({...actors[0],role:'viewer'}),e=>e.status===403);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM albums').first()).n,1);
  await assert.rejects(create({...actors[1],space_id:crypto.randomUUID()},{...input,id:crypto.randomUUID()}),e=>e.status===409);
  console.log('PASS: import layout atomicity, stable retry IDs, creator/scope/role checks, collision rejection and rollback of partial grouping failures.');
} finally {await runtime.dispose();delete globalThis.__importEnv;}
