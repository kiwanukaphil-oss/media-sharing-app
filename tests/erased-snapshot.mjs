import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { minimiseErasedSnapshot, providerIdentityDigest } from '../scripts/minimise-erased-snapshot.mjs';
import { reconcileErasedSnapshot } from '../scripts/reconcile-erased-snapshot.mjs';
import { inspectHistoricalSnapshot } from '../scripts/inventory-historical-snapshots.mjs';
import { importSnapshot } from '../scripts/relay-backup.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from '../scripts/backup-d1-readonly.mjs';

const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for (const migration of journal) database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
    ('gone','https://fixture/','private-subject','Private name','private@example.test',1),
    ('kept','https://fixture/','kept','Kept','kept@example.test',1);
    INSERT INTO spaces VALUES ('personal','Sensitive title',1),('shared','Shared',1),('other','Other',1);
    INSERT INTO personal_spaces VALUES ('personal','gone',1000),('other','kept',1000);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES
      ('private-member','gone','personal','owner',1),('shared-member','gone','shared','owner',1),('kept-member','kept','shared','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES
      ('private-device','personal','Private device','private-token',1,999),('shared-device','shared','Private shared device','shared-token',1,999),
      ('other-device','other','Other device','other-token',1,999);
    INSERT INTO account_space_actors VALUES ('private-member','private-device'),('shared-member','shared-device');
    INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,provider_session_id)
      VALUES ('session','gone','private-session-token','config',1,999,'provider-session');
    INSERT INTO recovery_watermarks VALUES ('https://fixture/','private-subject',1);
    INSERT INTO account_deletion_requests VALUES ('request','gone',1,'pending',1);
    INSERT INTO albums(id,space_id,name,created_at) VALUES ('album','personal','Secret album',1);
    INSERT INTO album_sections(album_id,id,name) VALUES ('album','section','Secret section');`);
  const media = database.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
    VALUES (?,?,?,?,'image/png',10,?,'original',?,'upload',16,'ready',1)`);
  media.run('private','personal','private-device','Secret name','a'.repeat(64),'personal/secret');
  media.run('published','shared','shared-device','Shared name','a'.repeat(64),'shared/keep');
  media.run('other','other','other-device','Other name','b'.repeat(64),'other/keep');
  database.exec(`INSERT INTO album_media VALUES ('album','private','section');
    INSERT INTO publications(id,source_id,source_space_id,destination_space_id,person_id,source_revision,created_at,phase,attempt_key)
      VALUES ('published','private','personal','shared','gone',0,1,'ready','personal/attempt');
    INSERT INTO publication_attempts VALUES ('personal/attempt','published',1);`);
  const exportPlan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
  const sql = restoreReadOnlySnapshot(exportPlan,database.prepare(exportPlan.sql).all());
  const receipt = {formatVersion:1,personId:'gone',identityDigest:providerIdentityDigest('https://fixture/','private-subject')};
  const historical = inspectHistoricalSnapshot(sql);
  assert.equal(historical.minimisationSchemaReviewed,true);
  assert.equal(historical.people.length,2);
  assert.deepEqual(historical.contentReferences.find(entry=>entry.sha256==='a'.repeat(64)).references.map(entry=>entry.personalOwner),['gone',null]);
  assert.equal(historical.completedOriginalReferences,3);
  const output = minimiseErasedSnapshot(sql,receipt,1000);
  // Authenticate the decision independently before transforming this actual-schema historical snapshot.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const ledger = {formatVersion:1,ledgerId:'fixture',keyId:'fixture',revision:1,issuedAt:900,expiresAt:2000,
    records:[{personId:'gone',requestId:'request',identityDigest:receipt.identityDigest,state:'fulfilled',updatedAt:800,evidenceDigest:'a'.repeat(64)}]};
  const payload = Buffer.from(JSON.stringify(ledger));
  const envelope = {payload:payload.toString('base64url'),signature:sign(null,
    Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')};
  const trust = {ledgerId:'fixture',keyId:'fixture',revision:1,headCheckedAt:1000,
    payloadDigest:createHash('sha256').update(payload).digest('hex'),publicKey:publicKey.export({type:'spki',format:'pem'})};
  const reconciled = reconcileErasedSnapshot(sql,envelope,trust,'gone',1000);
  assert.equal(reconciled.sql,output.sql);
  assert.equal(reconciled.ledgerAuthenticated,true);
  assert.equal(reconciled.cutoverAllowed,false);
  assert.equal(reconciled.cloudErasureVerified,false);
  assert.throws(()=>reconcileErasedSnapshot(sql,envelope,{...trust,revision:2},'gone',1000));
  assert.equal(output.cutoverAllowed,false);
  assert.equal(output.cloudErasureVerified,false);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM media').get().n,3,'Source database remains unchanged.');
  const restored = importSnapshot(output.sql);
  try {
    assert.deepEqual(restored.prepare('SELECT id FROM media ORDER BY id').all().map(row=>row.id),['other','published']);
    assert.equal(restored.prepare("SELECT object_key FROM media WHERE id='published'").get().object_key,'shared/keep');
    assert.equal(restored.prepare("SELECT verified_email FROM people WHERE id='gone'").get().verified_email,'');
    assert.equal(restored.prepare("SELECT verified_email FROM people WHERE id='kept'").get().verified_email,'kept@example.test');
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM albums').get().n,0);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM publication_attempts').get().n,0);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM recovery_watermarks').get().n,0);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE revoked_at IS NULL').get().n,0);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE revoked_at IS NULL').get().n,0);
    assert.equal(restored.prepare('SELECT status FROM account_deletion_requests').get().status,'review_required');
    assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally { restored.close(); }
  const twice = minimiseErasedSnapshot(output.sql,receipt,1000);
  assert.equal(twice.sql,output.sql,'Reapplying the same receipt is stable.');
  assert.throws(()=>minimiseErasedSnapshot(sql,{...receipt,identityDigest:'0'.repeat(64)}),/match/);
  assert.throws(()=>minimiseErasedSnapshot(output.sql,{...receipt,identityDigest:'0'.repeat(64)}),/match/);
  assert.throws(()=>minimiseErasedSnapshot(sql,{...receipt,personId:'missing'}),/not found/);
  assert.throws(()=>minimiseErasedSnapshot(sql+'\nCREATE TABLE future_identity(value TEXT);',receipt),/schema/);
  assert.throws(()=>minimiseErasedSnapshot(sql+'\nALTER TABLE people ADD private_note TEXT;',receipt),/schema/);
  console.log('PASS: isolated snapshot minimisation, identity binding, private content removal, shared/other originals, access quarantine and replay stability.');
} finally { database.close(); }
