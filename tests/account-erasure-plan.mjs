import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { planAccountErasure } from '../scripts/plan-account-erasure.mjs';

const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for (const migration of journal) database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
    ('leaver','https://fixture/','leaver','Private name','private@example.test',1),
    ('keeper','https://fixture/','keeper','Other','other@example.test',1);
    INSERT INTO spaces(id,name,created_at) VALUES ('personal','Private',1),('shared','Shared',1),('other','Other private',1);
    INSERT INTO personal_spaces VALUES ('personal','leaver',1073741824),('other','keeper',1073741824);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES
      ('own','leaver','personal','owner',1),('member','leaver','shared','owner',1),('other-own','keeper','other','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES
      ('private-actor','personal','Private','private-token-hash',1,999),('shared-actor','shared','Shared','shared-token-hash',1,999),
      ('other-actor','other','Other','other-token-hash',1,999);
    INSERT INTO account_space_actors VALUES ('own','private-actor'),('member','shared-actor');
    INSERT INTO account_deletion_requests VALUES ('request','leaver',1,'pending',1);`);
  // Include Trash, unfinished uploads, another person's private bytes and a legitimate shared identical copy.
  const insertMedia = database.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,archived_at)
    VALUES (?,?,?,'Fixture','image/png',10,?,'original',?,'fixture-upload',16,?,1,?)`);
  insertMedia.run('private-original','personal','private-actor','same-hash','personal/original','ready',null);
  insertMedia.run('private-trash','personal','private-actor','trash-hash','personal/trash','ready',2);
  insertMedia.run('private-upload','personal','private-actor','pending-hash','personal/pending','uploading',null);
  insertMedia.run('published','shared','shared-actor','same-hash','shared/copy','ready',null);
  insertMedia.run('other-private','other','other-actor','other-hash','other/original','ready',null);
  database.exec(`INSERT INTO publications(id,source_id,source_space_id,destination_space_id,person_id,source_revision,created_at,phase)
    VALUES ('published','private-original','personal','shared','leaver',0,1,'ready'),
    ('pending-copy','private-original','personal','shared','leaver',0,2,'pending');
    INSERT INTO publication_attempts VALUES ('shared/unfinished-copy','pending-copy',2);`);
  const before = database.prepare('SELECT total_changes() AS n').get().n;
  const first = planAccountErasure(database,'request');
  assert.equal(first.executable,false);
  assert.equal(first.mode,'review-only');
  assert.deepEqual(first.inventory.personalMedia.map(row=>row.id),['private-original','private-trash','private-upload']);
  assert.deepEqual(first.inventory.sharedMediaToPreserve.map(row=>row.id),['published']);
  assert.equal(first.inventory.backupContent.find(row=>row.sha256==='same-hash').currentOtherSpaceReferences,1);
  assert.ok(!JSON.stringify(first).includes('other/original'));
  assert.doesNotMatch(JSON.stringify(first), /token-hash/);
  assert.ok(first.blockers.includes('shared-last-owner-handover-required'));
  assert.ok(first.blockers.includes('personal-uploads-need-reconciliation'));
  assert.ok(first.blockers.includes('publication-operations-need-reconciliation'));
  assert.equal(database.prepare('SELECT total_changes() AS n').get().n,before,'Planning must not write even to the supplied database.');
  assert.equal(planAccountErasure(database,'request').inventoryFingerprint,first.inventoryFingerprint);
  database.exec("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES ('new-owner','keeper','shared','owner',2)");
  const handedOver=planAccountErasure(database,'request');
  assert.ok(!handedOver.blockers.includes('shared-last-owner-handover-required'));
  assert.notEqual(handedOver.inventoryFingerprint,first.inventoryFingerprint);
  database.exec("UPDATE people SET disabled_at=3 WHERE id='keeper'");
  assert.ok(planAccountErasure(database,'request').blockers.includes('shared-last-owner-handover-required'));
  for (const status of ['withdrawn','review_required','fulfilled','unexpected']) {
    database.prepare('UPDATE account_deletion_requests SET status=?').run(status);
    assert.ok(planAccountErasure(database,'request').blockers.includes('request-is-not-current-pending-intent'));
  }
  assert.throws(()=>planAccountErasure(database,'missing'),/not present/);
  console.log('PASS: read-only erasure inventory, exact personal ownership, Trash/uploads, shared copies, deduplicated backup dependencies and intent/handover blockers.');
} finally { database.close(); }
