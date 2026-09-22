import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectIntakeSnapshot,minimiseIntakeIdentity} from '../scripts/intake-lifecycle.mjs';
import {planAccountErasure} from '../scripts/plan-account-erasure.mjs';
import {reconcileLiveObjectInventory,liveObjectInventoryQuery,liveIntakeObjectInventoryQuery} from '../scripts/reconcile-live-object-inventory.mjs';
import {sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const db=new DatabaseSync(':memory:');
try{
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  assert.equal(inspectIntakeSnapshot(db,'recipient').present,false);
  db.exec(await readFile('docs/prototypes/upload-request-schema.sql','utf8'));
  db.exec(`INSERT INTO spaces VALUES('shared','Shared',1);
    INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
    ('owner','fixture','owner','Owner','owner@example.test',1),('recipient','fixture','recipient','Recipient','recipient@example.test',1),('other','fixture','other','Other','other@example.test',1);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES('owner','owner','shared','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES('actor','shared','Intake','dead-attribution',1,0);
    INSERT INTO albums(id,space_id,name,created_at) VALUES('album','shared','Shared album',1);
    INSERT INTO account_deletion_requests VALUES('deletion','recipient',1,'pending',1);`);
  const seed=db.prepare(`INSERT INTO upload_requests(id,token_hash,space_id,issuer_membership_id,recipient_email,accepted_by,accepted_at,title,album_id,created_at,expires_at,max_files,max_file_bytes,max_bytes,state)
    VALUES(?,?,'shared','owner',?,?,1,'Collection','album',1,10000,10,20,200,'open')`);
  seed.run('request','secret-hash','recipient@example.test','recipient');
  seed.run('other-request','other-secret','other@example.test','other');
  const media=db.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at) VALUES(?,'shared','actor','Original','image/jpeg',4,?,'original',?,'upload',16,?,1)`);
  for(const [id,request,person,phase,status] of [['accepted','request','recipient','accepted','ready'],['staged','request','recipient','received','pending-review'],['foreign','other-request','other','received','pending-review']]){
    media.run(id,'a'.repeat(64),`shared/${id}`,status);
    db.prepare('INSERT INTO intake_submissions(id,request_id,person_id,size,sha256,created_at,phase) VALUES(?,?,?,4,?,1,?)').run(id,request,person,'a'.repeat(64),phase);
    db.prepare("INSERT INTO intake_upload_attempts VALUES(?,?,'upload','active',1)").run(`shared/${id}`,id);
    db.prepare("INSERT INTO intake_capabilities VALUES(?,?,?,'upload',1,4,1,60001,NULL)").run(id,id,`shared/${id}`);
  }
  // Custody survives a missing media row and expired capabilities; neither is proof of byte erasure.
  db.exec("INSERT INTO intake_upload_attempts VALUES('shared/late','staged','late-upload','uncertain',1)");
  const inventory=inspectIntakeSnapshot(db,'recipient');
  assert.equal(inventory.capabilities.length,2);assert.equal(inventory.attempts.length,3);
  assert.deepEqual(inventory.sharedMediaToPreserve.map(row=>row.id),['accepted']);
  assert.doesNotMatch(JSON.stringify(inventory),/other-secret|shared\/foreign|recipient@example/);
  const plan=planAccountErasure(db,'deletion');
  assert.deepEqual(plan.inventory.sharedMediaToPreserve.map(row=>row.id),['accepted']);
  assert.ok(plan.blockers.includes('intake-storage-disposition-required'));
  assert.ok(plan.blockers.includes('intake-staged-originals-need-reconciliation'));
  const metadata=JSON.parse(db.prepare(liveObjectInventoryQuery).get().inventory);
  metadata.intake=JSON.parse(db.prepare(liveIntakeObjectInventoryQuery).get().inventory);
  const catalog={listingComplete:true,bucketName:'relay-media-originals',fingerprint:'fixture',objects:['accepted','staged','foreign'].map(id=>({key:`shared/${id}`,size:4,etag:'etag'})),unfinishedUploads:[{key:'shared/late',uploadId:'late-upload'}]};
  const reconciled=reconcileLiveObjectInventory(metadata,catalog);
  assert.equal(reconciled.executable,false);assert.deepEqual(reconciled.multipart[0].mediaIds,['staged']);assert.equal(reconciled.anomalies.length,0);
  assert.throws(()=>reconcileLiveObjectInventory({...metadata,intake:undefined},catalog),/custody/);
  const before=JSON.stringify(db.prepare('SELECT * FROM media ORDER BY id').all());
  minimiseIntakeIdentity(db,'recipient','recipient@example.test',20000);
  const minimised=db.prepare("SELECT * FROM upload_requests WHERE id='request'").get();
  assert.equal(minimised.recipient_email,'');assert.equal(minimised.token_hash,'erased-intake:request');assert.equal(minimised.state,'closed');
  assert.equal(db.prepare("SELECT token_hash FROM upload_requests WHERE id='other-request'").get().token_hash,'other-secret');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM media ORDER BY id').all()),before);
  assert.equal(inspectIntakeSnapshot(db,'recipient').attempts.length,3);
  assert.throws(()=>db.exec("UPDATE upload_requests SET state='open' WHERE id='request'"),/cannot reopen/);
  assert.throws(()=>db.exec("UPDATE upload_requests SET recipient_email='new@example.test' WHERE id='request'"),/immutable/);
  assert.throws(()=>db.exec("UPDATE upload_requests SET token_hash='new-token' WHERE id='request'"),/immutable/);
  sanitizeRestoredAccess(db,30000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM upload_requests WHERE revoked_at IS NULL').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM intake_capabilities').get().n,3);
  assert.equal(db.prepare("SELECT status FROM media WHERE id='accepted'").get().status,'ready');
  assert.equal(db.prepare("SELECT status FROM media WHERE id='staged'").get().status,'cancelling');
  console.log('PASS intake lifecycle: exact identity custody, retained shared originals, contact minimisation, immutable closure, late multipart inventory, no deletion authority and restored quarantine');
}finally{db.close();}
