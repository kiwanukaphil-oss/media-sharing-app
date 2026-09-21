import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

// Replace only the Workers binding import. Execute real route helpers, body validation and SQL against
// isolated D1 while retaining the already-authenticated principal across a live authority change.
globalThis.__libraryAuthorityEnv={};
const bundle=await build({entryPoints:['lib/library-api.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'isolated-binding',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__libraryAuthorityEnv;',loader:'js'}));},
}]});
const {libraryAction}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(member,person,space,now),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,0)').bind(member,space,'Fixture',`account-attribution:${member}`,now),
    database.prepare('INSERT INTO account_space_actors VALUES(?,?)').bind(member,member),
    database.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').bind(session,person,session,'fixture',now,now+3600000,now),
    database.prepare('INSERT INTO albums(id,space_id,name,created_at) VALUES(?,?,?,?),(?,?,?,?)').bind(album,space,'Album',now,emptyAlbum,space,'Empty',now),
    database.prepare('INSERT INTO album_sections(album_id,id,name,position) VALUES(?,?,?,0)').bind(album,section,'Section'),
    database.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,?,?,'fixture.jpg','image/jpeg',4,?,'original',?,'fixture',4,'ready',?)").bind(media,space,member,'a'.repeat(64),`${space}/${media}/original`,now),
    database.prepare('INSERT INTO album_media(album_id,media_id,section_id) VALUES(?,?,?)').bind(album,media,section),
  ]);
  const actor={id:member,space_id:space,role:'owner',authentication:'account',personId:person,sessionId:session};
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
      ["UPDATE space_memberships SET role='member'","UPDATE space_memberships SET role='owner'"],
      ["UPDATE account_sessions SET revoked_at=1","UPDATE account_sessions SET revoked_at=NULL"],
    ]){
      await database.prepare(deny).run();const before=await snapshot();
      await assert.rejects(invoke(),error=>error.status===409,`${resource}/${id??'create'} must reject stale authority`);
      assert.equal(await snapshot(),before,'Denied route must leave all metadata unchanged');
      await database.prepare(restore).run();
    }
    assert.equal((await invoke()).status,200,'Current owner retains the legitimate workflow');
  }
  console.log('PASS: real album, rename, capture-date, membership, section create/update/order/template/placement routes reject disabled accounts, stale owner roles and revoked sessions atomically; current owners still succeed.');
} finally {await runtime.dispose();}
