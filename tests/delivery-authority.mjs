import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {planReadOnlySnapshot,schemaQuery} from '../scripts/backup-d1-readonly.mjs';
import {sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const bundle=await build({entryPoints:['lib/delivery-authority.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {acceptDelivery,deliveryRecipientAuthority}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const db=new DatabaseSync(':memory:'),now=Date.now();
try{
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  db.exec(await readFile('docs/prototypes/delivery-schema.sql','utf8'));
  db.exec("INSERT INTO spaces VALUES('shared','Studio',1)");
  for(const person of ['owner','recipient','other']){
    db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').run(person,'fixture',person,person,person+'@example.test',now);
    db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(person,person,person,'fixture',now,now+3600000,now);
  }
  db.exec(`INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES('owner','owner','shared','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES('actor','shared','Actor','dead',1,0);
    INSERT INTO asset_scopes VALUES('scope','shared','Hidden source audience','owner',1);
    INSERT INTO scope_grants VALUES('scope','owner','owner',1,NULL);
    INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id)
      VALUES('file','shared','actor','Snapshot title.jpg','image/jpeg',4,'hash','original','private/key','upload',16,'ready',1,'scope');`);
  const seed=(id,token)=>{
    db.prepare("INSERT INTO delivery_snapshots(id,space_id,issuer_membership_id,access_scope_id,title,intent_hash,file_count,total_bytes,created_at,expires_at) VALUES(?,'shared','owner','scope','Reviewed delivery','intent',1,4,?,?)").run(id,now,now+86400000);
    db.prepare("INSERT INTO delivery_items VALUES(?,'file',0,0,'Snapshot title.jpg','image/jpeg',4,'hash',NULL)").run(id);
    db.prepare("INSERT INTO delivery_recipients(id,delivery_id,email,token_hash) VALUES(?,?,'recipient@example.test',?)").run(id,id,token);
  };
  seed('delivery','a'.repeat(64));seed('draft','b'.repeat(64));
  db.exec("UPDATE delivery_snapshots SET state='issued' WHERE id='delivery'");
  assert.throws(()=>db.exec("UPDATE delivery_items SET name='Changed'"),/immutable/);
  const plan=planReadOnlySnapshot(db.prepare(schemaQuery).all()),snapshot=JSON.parse(db.prepare(plan.sql).get().snapshot);
  const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'delivery-authority',modules:true,script:'export default {fetch(){return new Response("fixture");}}',d1Databases:['DB']}]}));
  try{
    const d1=await runtime.getD1Database('DB');
    for(const statement of plan.schema.filter(row=>row.type==='table'))await d1.prepare(statement.sql).run();
    await d1.batch([d1.prepare('PRAGMA defer_foreign_keys=ON'),...snapshot.tables.flatMap(table=>table.rows.map(statement=>d1.prepare(statement)))]);
    for(const statement of plan.schema.filter(row=>row.type!=='table'))await d1.prepare(statement.sql).run();
    const session=person=>({personId:person,sessionId:person,displayName:person,verifiedEmail:person+'@example.test',createdAt:now,expiresAt:now+3600000,sessionMode:'temporary'});
    await assert.rejects(acceptDelivery(d1,session('other'),'a'.repeat(64),now),/unavailable/);
    await assert.rejects(acceptDelivery(d1,session('recipient'),'b'.repeat(64),now),/unavailable/);
    const accepted=await acceptDelivery(d1,session('recipient'),'a'.repeat(64),now);assert.equal(accepted.id,'delivery');
    assert.doesNotMatch(JSON.stringify(accepted),/private\/key|Hidden source|token_hash/);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM space_memberships').first()).n,1);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM scope_grants').first()).n,1);
    const readable=async(person='recipient',time=now)=>{const guard=deliveryRecipientAuthority(session(person),time);return d1.prepare(`SELECT delivery_snapshots.id FROM delivery_snapshots JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id WHERE delivery_snapshots.id='delivery' AND ${guard.sql}`).bind(...guard.bindings).first();};
    assert.equal((await readable()).id,'delivery');assert.equal(await readable('other'),null);assert.equal(await readable('recipient',now+86400001),null);
    await d1.prepare("UPDATE people SET verified_email='changed@example.test' WHERE id='recipient'").run();
    assert.equal((await acceptDelivery(d1,session('recipient'),'a'.repeat(64),now)).id,'delivery');
    await d1.prepare("UPDATE people SET verified_email='recipient@example.test' WHERE id='other'").run();
    await assert.rejects(acceptDelivery(d1,session('other'),'a'.repeat(64),now),/unavailable/);
    await d1.prepare("UPDATE account_sessions SET revoked_at=? WHERE id='recipient'").bind(now).run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE account_sessions SET revoked_at=NULL WHERE id='recipient'").run();
    await d1.prepare("UPDATE people SET credentials_changed_at=? WHERE id='recipient'").bind(now+1).run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE people SET credentials_changed_at=0 WHERE id='recipient'").run();
    // Renames preserve the reviewed labels. Trash and grant loss suspend external access permanently
    // until a deliberate sender re-review; putting a file back or regranting access is insufficient.
    await d1.prepare("UPDATE media SET name='New working name.jpg',revision=1 WHERE id='file'").run();assert.ok(await readable());
    assert.equal((await d1.prepare('SELECT name FROM delivery_items LIMIT 1').first()).name,'Snapshot title.jpg');
    await d1.prepare("UPDATE media SET archived_at=? WHERE id='file'").bind(now).run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE media SET archived_at=NULL WHERE id='file'").run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE delivery_snapshots SET state='issued' WHERE id='delivery'").run();
    await d1.prepare("UPDATE scope_grants SET revoked_at=? WHERE scope_id='scope'").bind(now).run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE scope_grants SET revoked_at=NULL WHERE scope_id='scope'").run();assert.equal(await readable(),null);
    await d1.prepare("UPDATE delivery_snapshots SET state='issued' WHERE id='delivery'").run();
    await d1.prepare("DELETE FROM media WHERE id='file'").run();assert.equal(await readable(),null);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM delivery_items').first()).n,2,'Retained IDs do not block legitimate source removal');
  }finally{await runtime.dispose();}
  sanitizeRestoredAccess(db,now);assert.equal(db.prepare("SELECT state FROM delivery_snapshots WHERE id='delivery'").get().state,'suspended');
  console.log('PASS delivery authority: named-person binding without membership, immutable labels, all-source availability, session/recovery denial, sticky Trash/grant suspension and restored quarantine');
}finally{db.close();}
