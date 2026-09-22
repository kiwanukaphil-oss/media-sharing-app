import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectDeliverySnapshot,minimiseDeliveryIdentity} from '../scripts/delivery-lifecycle.mjs';
import {planReadOnlySnapshot,restoreReadOnlySnapshot,schemaQuery} from '../scripts/backup-d1-readonly.mjs';
import {minimiseErasedSnapshot,providerIdentityDigest} from '../scripts/minimise-erased-snapshot.mjs';
import {importSnapshot,sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const db=new DatabaseSync(':memory:');
try{
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  assert.equal(inspectDeliverySnapshot(db,'owner').present,true);
  // Migration 0026 installs the reviewed schema and protective triggers.
  db.exec(`INSERT INTO spaces VALUES('shared','Shared',1);
    INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
    ('owner','fixture','owner','Owner','owner@example.test',1),('recipient','fixture','recipient','Recipient','recipient@example.test',1),('other','fixture','other','Other','other@example.test',1);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES('owner','owner','shared','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES('actor','shared','Attribution','dead',1,0);
    INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
      VALUES('file','shared','actor','Captured original','image/jpeg',4,'hash','original','shared/file','upload',16,'ready',1);
    INSERT INTO delivery_snapshots(id,space_id,issuer_membership_id,title,sender_name,intent_hash,file_count,total_bytes,created_at,expires_at)
      VALUES('delivery','shared','owner','Private title','Private sender','intent',1,4,1,100000);
    INSERT INTO delivery_items VALUES('delivery','file',0,0,'Captured original','image/jpeg',4,'hash',NULL);
    INSERT INTO delivery_recipients VALUES('recipient','delivery','recipient@example.test','token-one','recipient',1,NULL),('other','delivery','other@example.test','token-two','other',1,NULL);
    UPDATE delivery_snapshots SET state='issued';`);
  const exportPlan=planReadOnlySnapshot(db.prepare(schemaQuery).all());
  const sql=restoreReadOnlySnapshot(exportPlan,db.prepare(exportPlan.sql).all());
  const result=minimiseErasedSnapshot(sql,{formatVersion:1,personId:'owner',identityDigest:providerIdentityDigest('fixture','owner')},100);
  assert.equal(result.cutoverAllowed,false);assert.equal(result.cloudErasureVerified,false);
  const restored=importSnapshot(result.sql);
  try{
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM delivery_items').get().n,0);
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM media').get().n,1);
    assert.equal(restored.prepare("SELECT COUNT(*) n FROM delivery_recipients WHERE email<>'' OR revoked_at IS NULL").get().n,0);
  }finally{restored.close();}
  const originals=JSON.stringify(db.prepare('SELECT * FROM media').all());
  const inventory=inspectDeliverySnapshot(db,'recipient');assert.equal(inventory.snapshots.length,0);assert.equal(inventory.recipients.length,1);
  assert.doesNotMatch(JSON.stringify(inventory),/@example|Captured original|Private title|token-one/);
  minimiseDeliveryIdentity(db,'recipient','recipient@example.test',100);
  assert.equal(db.prepare("SELECT state FROM delivery_snapshots").get().state,'issued');
  assert.equal(db.prepare("SELECT revoked_at FROM delivery_recipients WHERE id='other'").get().revoked_at,null);
  assert.equal(db.prepare("SELECT token_hash FROM delivery_recipients WHERE id='recipient'").get().token_hash,'erased-delivery-recipient:recipient');
  assert.throws(()=>db.exec("UPDATE delivery_recipients SET email='new@example.test' WHERE id='recipient'"),/cannot rebind/);
  assert.throws(()=>db.exec("UPDATE delivery_recipients SET accepted_by='other' WHERE id='recipient'"),/cannot rebind/);
  assert.throws(()=>db.exec("UPDATE delivery_snapshots SET title='Changed'"),/immutable/);
  minimiseDeliveryIdentity(db,'owner','owner@example.test',200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM delivery_items').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM delivery_recipients WHERE email<>'' OR revoked_at IS NULL").get().n,0);
  assert.equal(db.prepare('SELECT sender_name FROM delivery_snapshots').get().sender_name,'Deleted member');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM media').all()),originals);
  assert.throws(()=>db.exec("UPDATE delivery_snapshots SET state='issued'"),/cannot reopen/);
  assert.throws(()=>db.exec("UPDATE delivery_snapshots SET title='Recovered label'"),/immutable/);
  minimiseDeliveryIdentity(db,'owner','owner@example.test',300);
  sanitizeRestoredAccess(db,400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM delivery_recipients WHERE revoked_at IS NULL").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM delivery_snapshots WHERE state<>'revoked'").get().n,0);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM media').all()),originals);
  console.log('PASS delivery lifecycle: exact identity inventory, isolated recipient revocation, sender-label/contact minimisation, retained shared originals, immutable redaction and restored link quarantine');
}finally{db.close();}
