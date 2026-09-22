import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {planReadOnlySnapshot,schemaQuery} from '../scripts/backup-d1-readonly.mjs';
import {sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const bundle=await build({entryPoints:['lib/delivery-authority.ts','lib/delivery-management.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm'});
const modules=await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const {acceptDelivery,deliveryRecipientAuthority}=modules.find(module=>module.acceptDelivery);
const {createDeliveryDraft,issueDelivery,revokeDelivery}=modules.find(module=>module.createDeliveryDraft);
const db=new DatabaseSync(':memory:'),now=Date.now();
try{
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  // Migration 0026 installs the reviewed schema and protective triggers.
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
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM delivery_items').first()).n,0,'Permanent source removal also removes captured metadata');
    // All-or-nothing sender drafting, exact concurrent retry and explicit issue/reactivation.
    await d1.prepare("UPDATE devices SET token_hash='account-attribution:owner',role='owner' WHERE id='actor'").run();
    await d1.prepare("INSERT INTO account_space_actors VALUES('owner','actor')").run();
    const owner={...session('owner'),id:'actor',space_id:'shared',space_name:'Studio',space_kind:'shared',authentication:'account',role:'owner',name:'Owner'};
    const mediaId=crypto.randomUUID(),otherMedia=crypto.randomUUID(),scopeId=crypto.randomUUID();
    await d1.prepare("INSERT INTO asset_scopes VALUES(?,'shared','Delivery scope','owner',?)").bind(scopeId,now).run();
    await d1.prepare("INSERT INTO scope_grants VALUES(?,'owner','owner',?,NULL)").bind(scopeId,now).run();
    for(const [fileId,audience] of [[mediaId,scopeId],[otherMedia,null]])await d1.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id)
      VALUES(?,'shared','actor','Original.jpg','image/jpeg',4,?,'original',?,'upload',16,'ready',?,?)`).bind(fileId,'c'.repeat(64),'shared/'+fileId,now,audience).run();
    const draft={id:crypto.randomUUID(),title:'Reviewed draft',accessScopeId:scopeId,files:[{id:mediaId,revision:0}],recipients:[{id:crypto.randomUUID(),email:'changed@example.test',tokenHash:'c'.repeat(64)}],expiresAt:now+86400000,confirmed:true,confirmAudienceExpansion:true};
    const mixed={...draft,id:crypto.randomUUID(),files:[...draft.files,{id:otherMedia,revision:0}]};
    await assert.rejects(createDeliveryDraft(d1,owner,mixed,now),/changed/);
    assert.equal(await d1.prepare('SELECT id FROM delivery_snapshots WHERE id=?').bind(mixed.id).first(),null);
    const drafts=await Promise.all([createDeliveryDraft(d1,owner,draft,now),createDeliveryDraft(d1,owner,draft,now)]);
    assert.equal(drafts[0].id,drafts[1].id);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM delivery_items WHERE delivery_id=?').bind(draft.id).first()).n,1);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM delivery_recipients WHERE delivery_id=?').bind(draft.id).first()).n,1);
    await assert.rejects(createDeliveryDraft(d1,owner,{...draft,title:'Different review'},now),/changed/);
    await assert.rejects(acceptDelivery(d1,session('recipient'),'c'.repeat(64),now),/unavailable/);
    await d1.prepare('UPDATE media SET revision=1 WHERE id=?').bind(mediaId).run();
    await assert.rejects(issueDelivery(d1,owner,draft.id,0,now),/changed/);
    await d1.prepare('UPDATE media SET revision=0 WHERE id=?').bind(mediaId).run();
    assert.equal((await issueDelivery(d1,owner,draft.id,0,now)).revision,1);
    assert.equal((await issueDelivery(d1,owner,draft.id,0,now)).revision,1,'Lost issue response is idempotent');
    assert.equal((await acceptDelivery(d1,session('recipient'),'c'.repeat(64),now)).id,draft.id);
    await d1.prepare("UPDATE media SET archived_at=?,name='Later working name',revision=1 WHERE id=?").bind(now,mediaId).run();
    await d1.prepare('UPDATE media SET archived_at=NULL WHERE id=?').bind(mediaId).run();
    await assert.rejects(acceptDelivery(d1,session('recipient'),'c'.repeat(64),now),/unavailable/);
    assert.equal((await issueDelivery(d1,owner,draft.id,2,now)).revision,3);
    assert.equal((await d1.prepare('SELECT name FROM delivery_items WHERE delivery_id=?').bind(draft.id).first()).name,'Original.jpg');
    assert.equal((await revokeDelivery(d1,owner,draft.id,3,now)).revision,4);
    await assert.rejects(acceptDelivery(d1,session('recipient'),'c'.repeat(64),now),/unavailable/);
    await assert.rejects(issueDelivery(d1,owner,draft.id,4,now),/unavailable/);
    const collision={...draft,id:crypto.randomUUID(),files:[{id:mediaId,revision:1}],recipients:[{id:crypto.randomUUID(),email:'third@example.test',tokenHash:'a'.repeat(64)}]};
    await assert.rejects(createDeliveryDraft(d1,owner,collision,now));
    assert.equal(await d1.prepare('SELECT id FROM delivery_snapshots WHERE id=?').bind(collision.id).first(),null,'Recipient collision rolls back the complete draft');
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM delivery_items WHERE delivery_id=?').bind(collision.id).first()).n,0);
    await d1.prepare("UPDATE space_memberships SET role='editor' WHERE id='owner'").run();
    await assert.rejects(createDeliveryDraft(d1,owner,{...collision,id:crypto.randomUUID()},now),/changed/);


  }finally{await runtime.dispose();}
  sanitizeRestoredAccess(db,now);assert.equal(db.prepare("SELECT state FROM delivery_snapshots WHERE id='delivery'").get().state,'revoked');
  console.log('PASS delivery authority: named-person binding without membership, immutable labels, all-source availability, session/recovery denial, sticky Trash/grant suspension, atomic drafting/rollback, explicit issue/review/revoke and restored quarantine');
}finally{db.close();}
