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
  const exportFiles=async(actor,files=[{id:file,expectedRevision:0}])=>(await webAction(new Request('https://fixture.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files})}),actor,'metadata-export',undefined,undefined,{})).json();
  const album=crypto.randomUUID(),section=crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO albums(id,space_id,name,description,created_at) VALUES(?,?,?,?,?)').bind(album,space,'Album','Portable description',now),
    db.prepare('INSERT INTO album_sections(album_id,id,name) VALUES(?,?,?)').bind(album,section,'Custom section'),
    db.prepare('INSERT INTO album_media VALUES(?,?,?)').bind(album,file,section),
    db.prepare('UPDATE media SET original_name=?,captured_at=? WHERE id=?').bind('camera-original.jpg','2025-02-03T11:12:13',file),
  ]);
  const result=await exportFiles(actors[0],[{id:file,expectedRevision:0},{id:second,expectedRevision:0}]);
  assert.equal(result.format,'relay-metadata');assert.equal(result.includesOriginalBytes,false);assert.equal(result.files.length,2);
  const first=result.files.find(row=>row.id===file),other=result.files.find(row=>row.id===second);
  assert.equal(first.originalName,'camera-original.jpg');assert.equal(first.capturedAt,'2025-02-03T11:12:13');
  assert.equal(first.albums[0].section.name,'Custom section');assert.equal(first.albums[0].description,'Portable description');
  assert.notEqual(first.suggestedPath,other.suggestedPath,'Identical names have collision-safe portable paths.');
  for(const excluded of ['object_key','token','email','isFavorite'])assert.equal(JSON.stringify(result).includes(excluded),false);
  await assert.rejects(exportFiles(actors[0],[{id:file,expectedRevision:1}]),e=>e.status===409);
  await assert.rejects(exportFiles(actors[0],[{id:file,expectedRevision:0},{id:crypto.randomUUID(),expectedRevision:0}]),e=>e.status===409);
  await assert.rejects(exportFiles({...actors[0],space_id:crypto.randomUUID()}),e=>e.status===409);
  await assert.rejects(exportFiles(actors[0],Array(101).fill({id:file,expectedRevision:0})),e=>e.status===400);
  await db.prepare('UPDATE media SET archived_at=1 WHERE id=?').bind(file).run();
  assert.equal((await exportFiles(actors[0])).files[0].trashedAt,1);
  await db.prepare('UPDATE albums SET deleted_at=1 WHERE id=?').bind(album).run();
  assert.equal((await exportFiles(actors[0])).files[0].albums.length,0,'Removed groupings are not silently exported.');
  await db.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(now,actors[0].sessionId).run();
  await assert.rejects(exportFiles(actors[0]),e=>e.status===409);
  assert.equal((await exportFiles(actors[1])).files.length,1,'Other current Viewer access still works.');
  console.log('PASS: bounded Viewer metadata export, complete album/section mapping, collision-safe paths, no storage/identity/bookmark leakage, stale selection and revoked/foreign access denial.');
} finally { await runtime.dispose(); delete globalThis.__metadataEnv; }
