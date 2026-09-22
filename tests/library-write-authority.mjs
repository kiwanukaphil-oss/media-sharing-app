import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

// Replace only the Workers binding import. Execute real route helpers, body validation and SQL against
// isolated D1 while retaining the already-authenticated principal across a live authority change.
globalThis.__libraryAuthorityEnv={};
const bundle=await build({entryPoints:['lib/library-api.ts','lib/web-api.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'isolated-binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__libraryAuthorityEnv;',loader:'js'}));},
}]});
const modules=await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const {libraryAction}=modules.find(module=>module.libraryAction),{webAction}=modules.find(module=>module.webAction);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'library-authority-fixture',modules:true,
  script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
  const database=await runtime.getD1Database('DB');globalThis.__libraryAuthorityEnv.DB=database;
  const migrations=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for(const migration of migrations)for(const sql of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint'))
    if(sql.trim())await database.prepare(sql).run();
  const [person,space,member,session,album,emptyAlbum,section,media]=Array.from({length:8},()=>crypto.randomUUID()),now=Date.now();
  await database.batch([
    database.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Fixture',now),
    database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(person,'https://fixture.invalid/',person,'Fixture','fixture@example.invalid',now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'editor',?)").bind(member,person,space,now),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,0)').bind(member,space,'Fixture',`account-attribution:${member}`,now),
    database.prepare('INSERT INTO account_space_actors VALUES(?,?)').bind(member,member),
    database.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').bind(session,person,session,'fixture',now,now+3600000,now),
    database.prepare('INSERT INTO albums(id,space_id,name,created_at) VALUES(?,?,?,?),(?,?,?,?)').bind(album,space,'Album',now,emptyAlbum,space,'Empty',now),
    database.prepare('INSERT INTO album_sections(album_id,id,name,position) VALUES(?,?,?,0)').bind(album,section,'Section'),
    database.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'fixture.jpg','image/jpeg',4,?,'original',?,'fixture',4,'ready',?)").bind(media,space,member,'a'.repeat(64),`${space}/${media}/original`,now),
    database.prepare('INSERT INTO album_media(album_id,media_id,section_id) VALUES(?,?,?)').bind(album,media,section),
  ]);
  const actor={id:member,space_id:space,role:'editor',authentication:'account',personId:person,sessionId:session};
  const mediaRevision=async()=>(await database.prepare('SELECT revision FROM media WHERE id=?').bind(media).first()).revision;
  const albumRevision=async()=>(await database.prepare('SELECT revision FROM albums WHERE id=?').bind(album).first()).revision;
  const calls=[
    ['albums',undefined,'POST',async()=>({name:'Created'})],
    ['albums',album,'PUT',async()=>({name:'Renamed',description:'',archived:false,deleted:false,expectedRevision:await albumRevision()})],
    ['library','rename','POST',async()=>({files:[{id:media,name:'renamed.jpg',expectedRevision:await mediaRevision()}]})],
    ['library','capture-date','POST',async()=>({id:media,capturedAt:null,expectedRevision:await mediaRevision()})],
    ['library','organise','POST',async()=>({action:'add',albumId:emptyAlbum,files:[{id:media,expectedRevision:await mediaRevision()}]})],
    ['sections',undefined,'POST',async()=>({albumId:album,name:'New section',expectedRevision:await albumRevision()})],
    ['sections',section,'PUT',async()=>({albumId:album,name:'Changed section',expectedRevision:await albumRevision()})],
    ['sections','order','POST',async()=>({albumId:album,ids:(await database.prepare('SELECT id FROM album_sections WHERE album_id=?').bind(album).all()).results.map(row=>row.id),expectedRevision:await albumRevision()})],
    ['sections','template','POST',async()=>({albumId:emptyAlbum,files:[],expectedRevision:0})],
    ['library','sections','POST',async()=>({albumId:album,files:[{id:media,sectionId:null,expectedRevision:await mediaRevision()}]})],
  ];
  const snapshot=async()=>JSON.stringify(await Promise.all(['albums','album_sections','media','album_media'].map(async table=>(await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results)));
  for(const [resource,id,method,input] of calls){
    const invoke=async()=>libraryAction(new Request('https://fixture.invalid/api',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(await input())}),actor,resource,id);
    for(const [deny,restore] of [
      ["UPDATE people SET disabled_at=1","UPDATE people SET disabled_at=NULL"],
      ["UPDATE space_memberships SET role='member'","UPDATE space_memberships SET role='editor'"],
      ["UPDATE account_sessions SET revoked_at=1","UPDATE account_sessions SET revoked_at=NULL"],
    ]){
      await database.prepare(deny).run();const before=await snapshot();
      await assert.rejects(invoke(),error=>error.status===409,`${resource}/${id??'create'} must reject stale authority`);
      assert.equal(await snapshot(),before,'Denied route must leave all metadata unchanged');
      await database.prepare(restore).run();
    }
    assert.equal((await invoke()).status,200,'Current account Editor retains the legitimate workflow');
  }
  // Editor cancellation of another device's unfinished transfer uses current organiser authority.
  const otherDevice=crypto.randomUUID(),otherUpload=crypto.randomUUID();
  await database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(otherDevice,space,'Other contributor',otherDevice,now,now+3600000).run();
  await database.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'unfinished.jpg','image/jpeg',4,?,'original',?,'unfinished',4,'uploading',?)").bind(otherUpload,space,otherDevice,'b'.repeat(64),`${space}/${otherUpload}/original`,now).run();
  let dispatched=0;
  const cancellationStorage={delete:async()=>{dispatched++;},resumeMultipartUpload:()=>({abort:async()=>{dispatched++;}})};
  await database.prepare("UPDATE space_memberships SET role='member'").run();
  await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),actor,'uploads',otherUpload,undefined,cancellationStorage),error=>error.status===409);
  assert.equal(dispatched,0);
  await database.prepare("UPDATE space_memberships SET role='editor'").run();
  assert.equal((await webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),actor,'uploads',otherUpload,undefined,cancellationStorage)).status,200);
  assert.equal(dispatched,2);
  assert.equal(await database.prepare('SELECT id FROM media WHERE id=?').bind(otherUpload).first(),null);
  await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),actor,'media',media,undefined,cancellationStorage),error=>error.status===403);
  // Contributor bulk writes validate every row before any metadata changes; recorded legacy claims
  // count as ownership, labels do not. Cached Editor authority must not bypass the current role.
  const foreign=crypto.randomUUID();
  await database.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'foreign.jpg','image/jpeg',4,?,'original',?,'foreign',4,'ready',?)").bind(foreign,space,otherDevice,'c'.repeat(64),`${space}/${foreign}/original`,now).run();
  await database.prepare('INSERT INTO album_media(album_id,media_id,section_id) VALUES(?,?,?)').bind(album,foreign,section).run();
  await database.prepare("UPDATE space_memberships SET role='contributor'").run();
  actor.role='contributor';
  const postLibrary=async(id,body,principal=actor)=>libraryAction(new Request('https://fixture.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),principal,'library',id);
  const selection=async(ids)=>Promise.all(ids.map(async id=>({id,expectedRevision:(await database.prepare('SELECT revision FROM media WHERE id=?').bind(id).first()).revision})));
  for(const action of ['add','remove','trash']) {
    const before=await snapshot();
    await assert.rejects(postLibrary('organise',{action,albumId:album,files:await selection([media,foreign])}),error=>error.status===409);
    assert.equal(await snapshot(),before,'A mixed Contributor selection must change nothing');
  }
  for(const id of ['rename','sections']) {
    const files=(await selection([media,foreign])).map((file,index)=>({...file,name:`contributor-${index}.jpg`,sectionId:null}));
    const before=await snapshot();
    await assert.rejects(postLibrary(id,{files,albumId:album},{...actor,role:'editor'}),error=>error.status===409);
    assert.equal(await snapshot(),before,'Stale Editor role must not enable a mixed selection');
  }
  await assert.rejects(postLibrary('capture-date',{id:foreign,capturedAt:null,expectedRevision:0}),error=>error.status===409);
  await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'POST'}),actor,'media',foreign,'archive',cancellationStorage),error=>error.status===409);
  assert.equal((await postLibrary('rename',{files:[{...(await selection([media]))[0],name:'mine.jpg'}]})).status,200);
  assert.equal((await postLibrary('capture-date',{id:media,capturedAt:'2026-09-22T10:00:00',expectedRevision:await mediaRevision()})).status,200);
  assert.equal((await postLibrary('sections',{albumId:album,files:(await selection([media])).map(file=>({...file,sectionId:section}))})).status,200);
  for(const action of ['trash','restore','remove','add'])
    assert.equal((await postLibrary('organise',{action,albumId:album,files:await selection([media])})).status,200);
  // Same-name foreign device remains denied until the exact independent claim is recorded.
  await database.prepare('INSERT INTO legacy_owner_claims(device_id,membership_id,session_id,claimed_at) VALUES(?,?,?,?)').bind(otherDevice,member,session,now).run();
  assert.equal((await postLibrary('rename',{files:(await selection([media,foreign])).map((file,index)=>({...file,name:`claimed-${index}.jpg`}))})).status,200);
  await database.prepare('DELETE FROM legacy_owner_claims WHERE device_id=?').bind(otherDevice).run();
  const beforeUndo=await snapshot();
  await assert.rejects(postLibrary('organise',{action:'trash',files:await selection([foreign])}),error=>error.status===409);
  assert.equal(await snapshot(),beforeUndo,'Removing a claim ends subsequent authority');
  actor.role='owner';
  await database.prepare("UPDATE space_memberships SET role='owner'").run();
  // Permanent deletion and unfinished-upload cancellation must deny storage dispatch using a stale
  // resolved actor. Real D1 executes the authority check with the destructive state transition.
  for(const resource of ['media','uploads']) {
    await database.prepare('UPDATE media SET status=?,archived_at=? WHERE id=?')
      .bind(resource==='media'?'ready':'uploading',resource==='media'?1:null,media).run();
    for(const [deny,restore] of [
      ['UPDATE people SET disabled_at=1','UPDATE people SET disabled_at=NULL'],
      ['UPDATE people SET credentials_changed_at=?','UPDATE people SET credentials_changed_at=0'],
      ['UPDATE account_sessions SET revoked_at=1','UPDATE account_sessions SET revoked_at=NULL'],
      ["UPDATE space_memberships SET role='member'","UPDATE space_memberships SET role='owner'"],
    ]) {
      if(resource==='uploads' && deny.includes("role='member'")) continue; // Upload owners may cancel their own unfinished transfer.
      await (deny.includes('?')?database.prepare(deny).bind(now+1):database.prepare(deny)).run();
      const before=await snapshot();let dispatched=false;
      const storage={delete:async()=>{dispatched=true;},resumeMultipartUpload:()=>{dispatched=true;return {abort:async()=>{}};}};
      await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),actor,resource,media,undefined,storage),error=>error.status===409);
      assert.equal(dispatched,false);assert.equal(await snapshot(),before);
      await database.prepare(restore).run();
    }
    const interruptingStorage={
      delete:async()=>{await database.prepare('UPDATE people SET disabled_at=1 WHERE id=?').bind(person).run();},
      resumeMultipartUpload:()=>({abort:async()=>{}}),
    };
    await assert.rejects(webAction(new Request('https://fixture.invalid/api',{method:'DELETE'}),actor,resource,media,undefined,interruptingStorage),error=>error.status===409);
    assert.equal((await database.prepare('SELECT status FROM media WHERE id=?').bind(media).first()).status,resource==='media'?'deleting':'cancelling',
      'Authority loss after storage cleanup preserves a reviewable metadata record.');
    await database.prepare('UPDATE people SET disabled_at=NULL WHERE id=?').bind(person).run();
  }
  console.log('PASS: real album, rename, capture-date, membership, section create/update/order/template/placement routes reject disabled accounts, stale owner roles and revoked sessions atomically; current account Editors organise; owner-only destructive boundaries remain enforced.');
} finally {await runtime.dispose();}
