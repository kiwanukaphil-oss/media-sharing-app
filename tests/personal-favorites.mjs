import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Execute the real bookmark/feed helpers against disposable D1, with server-resolved Viewer actors.
globalThis.__favoritesEnv={};
const bundle=await build({entryPoints:['lib/web-api.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__favoritesEnv;',loader:'js'}));},
}]});
const {webAction,readFeed}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'favorites-fixture',modules:true,script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
  const db=await runtime.getD1Database('DB');globalThis.__favoritesEnv.DB=db;
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
  const favorite=(actor,id,value)=>webAction(new Request('https://fixture.invalid/api',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:value,personId:actors[1].personId})}),actor,'favorites',id,undefined,{});
  const feed=async(actor,query='favorites=1')=>(await readFeed(new Request('https://fixture.invalid/api/feed?'+query),actor)).json();
  assert.equal((await favorite(actors[0],file,true)).status,200);
  assert.equal((await feed(actors[0])).total,1);
  assert.equal((await feed(actors[1])).total,0,'A supplied personId cannot write another person bookmark.');
  assert.equal((await feed(actors[1],'')).items.every(item=>!item.isFavorite),true);
  await favorite(actors[1],file,true);await favorite(actors[0],file,false);
  assert.equal((await feed(actors[0])).total,0);assert.equal((await feed(actors[1])).total,1);
  await assert.rejects(favorite({...actors[0],space_id:crypto.randomUUID()},file,true),error=>error.status===409);
  await assert.rejects(favorite({...actors[0],authentication:undefined},file,true),error=>error.status===403);
  for(const [deny,restore] of [
    ['UPDATE account_sessions SET revoked_at=1 WHERE id=?','UPDATE account_sessions SET revoked_at=NULL WHERE id=?'],
    ['UPDATE account_sessions SET expires_at=0 WHERE id=?',`UPDATE account_sessions SET expires_at=${now+3600000} WHERE id=?`],
  ]) {
    await db.prepare(deny).bind(actors[0].sessionId).run();
    await assert.rejects(favorite(actors[0],file,true),error=>error.status===409);
    await assert.rejects(favorite(actors[0],file,false),error=>error.status===409);
    await db.prepare(restore).bind(actors[0].sessionId).run();
  }
  await favorite(actors[0],file,true);
  await db.prepare("WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<9999) INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) SELECT 'limit-'||v,?,?,'limit.txt','text/plain',1,?,'original','limit-'||v,'done',1,'ready',? FROM n").bind(space,actors[0].id,'b'.repeat(64),now).run();
  await db.prepare("INSERT INTO personal_favorites SELECT ?,id,? FROM media WHERE id LIKE 'limit-%'").bind(actors[0].personId,now).run();
  assert.equal((await favorite(actors[0],file,true)).status,200,'Idempotent retry works at capacity.');
  await assert.rejects(favorite(actors[0],second,true),error=>error.status===409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM personal_favorites WHERE person_id=?').bind(actors[0].personId).first()).n,10000);
  console.log('PASS: private person-bound Viewer bookmarks, scoped feed/totals, foreign/legacy denial, revocation and bounded idempotent capacity.');
} finally {await runtime.dispose();}
