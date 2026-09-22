import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
globalThis.__poolEnv = {};
const bundle = await build({entryPoints:['lib/server.ts','lib/web-api.ts','lib/storage-pool.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixture',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__poolEnv;',loader:'js'}));}}]});
const modules = await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const server=modules.find(m=>m.initializeUpload), web=modules.find(m=>m.readStorage), pool=modules.find(m=>m.storageQuota);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'pool-fixture',modules:true,script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
try {
 const db=await runtime.getD1Database('DB');globalThis.__poolEnv.DB=db;
 for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)for(const sql of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 const spaces=[crypto.randomUUID(),crypto.randomUUID()],person=crypto.randomUUID(),session=crypto.randomUUID(),now=Date.now();
 await db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(person,'https://fixture.invalid/',person,'Owner','fixture@example.invalid',now).run();
 await db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').bind(session,person,session,'fixture',now,now+3600000,now).run();
 const actors=[];
 for(const space of spaces){
  const member=crypto.randomUUID();
  await db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Fixture',now).run();
  await db.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(member,person,space,now).run();
  await db.prepare("INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES(?,?,?,?,'owner',?,?)").bind(member,space,'Fixture','account-attribution:'+member,now,0).run();
  await db.prepare('INSERT INTO account_space_actors VALUES(?,?)').bind(member,member).run();
  actors.push({id:member,space_id:space,name:'Owner',space_name:'Fixture',role:'owner',authentication:'account',personId:person,sessionId:session,storage_limit_bytes:1,space_kind:actors.length?'shared':'personal'});
 }
 await db.prepare('INSERT INTO personal_spaces VALUES(?,?,?)').bind(spaces[0],person,1).run();
 process.env.RELAY_STORAGE_POOL=JSON.stringify({spaceIds:spaces,limitBytes:10});
 assert.equal(server.spaceLimitBytes(actors[0]),10);
 assert.equal(pool.storageQuota(crypto.randomUUID(),7).limit,7);
 const storage={createMultipartUpload:async()=>({uploadId:crypto.randomUUID()}),resumeMultipartUpload:()=>({abort:async()=>{}})};
 const input=size=>({id:crypto.randomUUID(),name:'fixture.bin',mime:'application/octet-stream',size,sha256:'a'.repeat(64),category:'original'});
 const attempts=await Promise.allSettled(actors.map(actor=>server.initializeUpload(actor,input(6),storage)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1,'Two different spaces cannot each reserve six of ten shared bytes');
 assert.equal((await db.prepare('SELECT SUM(size) AS n FROM media').first()).n,6);
 const winner=attempts.findIndex(r=>r.status==='fulfilled');
 await db.prepare("UPDATE media SET status='ready',archived_at=?,preview_size=2").bind(now).run();
 await assert.rejects(server.initializeUpload(actors[1-winner],input(3),storage));
 await server.initializeUpload(actors[1-winner],input(2),storage);
 const summary=await (await web.readStorage(actors[0])).json();
 assert.equal(summary.poolUsed,10);assert.equal(summary.limit,10);assert.equal(summary.pooled,true);
 assert.equal((await pool.readStoragePoolSummary(db,{...actors[0],authentication:undefined})).poolUsed,undefined);
 await db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=?").bind(spaces[1]).run();
 assert.equal((await pool.readStoragePoolSummary(db,actors[0])).poolUsed,undefined,'Loss of common ownership hides combined private totals');
 process.env.RELAY_STORAGE_POOL='invalid';assert.throws(()=>pool.storageQuota(spaces[0],100));
 console.log('PASS: pooled D1 concurrent reservations, Trash/previews, exact boundary, default isolation and private aggregate authority.');
}finally{delete process.env.RELAY_STORAGE_POOL;await runtime.dispose();}

