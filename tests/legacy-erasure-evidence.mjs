import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { prepareLegacyErasureEvidence } from '../scripts/prepare-legacy-erasure-evidence.mjs';
import { providerIdentityDigest } from '../scripts/minimise-erased-snapshot.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from '../scripts/backup-d1-readonly.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const identity = providerIdentityDigest('https://fixture/','subject');
const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for (const migration of journal) database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES
    ('person','https://fixture/','subject','Same name','same@example.test',1),
    ('other','https://fixture/','different','Same name','same@example.test',1);
    INSERT INTO spaces VALUES ('shared','Shared',1),('elsewhere','Other',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES
    ('claimed','shared','Same name','one',1,999),('unclaimed','shared','Same name','two',1,999);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES
    ('membership','person','shared','owner',2),('other-member','other','shared','owner',2);
    INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at) VALUES
    ('session','person','session-token','config',3,999),('other-session','other','other-token','config',3,999);
    INSERT INTO legacy_owner_claims VALUES ('claimed','membership','session',4);`);
  const snapshot = () => {
    const plan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
    return restoreReadOnlySnapshot(plan,database.prepare(plan.sql).all());
  };
  const prepare = () => { const sql=snapshot(); return prepareLegacyErasureEvidence(sql,hash(sql),'person',identity); };
  const result = prepare(), evidence = JSON.parse(result.evidenceText);
  assert.deepEqual(evidence.legacyDevices,[{deviceId:'claimed',spaceId:'shared'}]);
  assert.equal(result.evidenceDigest,hash(result.evidenceText));
  assert.equal(result.executable,false); assert.equal(result.historicalCompletenessVerified,false);
  assert.equal(result.cloudErasureVerified,false); assert.equal(result.cutoverAllowed,false);
  assert.equal(result.evidenceText.includes('same@example.test'),false);
  assert.equal(result.evidenceText.includes('session-token'),false);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);
  const sql=snapshot();
  assert.throws(()=>prepareLegacyErasureEvidence(sql,hash(sql+'changed'),'person',identity),/Pinned/);
  assert.throws(()=>prepareLegacyErasureEvidence(sql,hash(sql),'person',hash('wrong')),/identity/);
  assert.throws(()=>prepareLegacyErasureEvidence(sql,hash(sql),'missing',identity),/identity/);
  const other=prepareLegacyErasureEvidence(sql,hash(sql),'other',providerIdentityDigest('https://fixture/','different'));
  assert.equal(other.recordedClaims,0); assert.equal(other.historicalCompletenessVerified,false);
  // Later revocation or demotion does not erase a verified historical relationship.
  database.exec("UPDATE devices SET revoked_at=10,expires_at=0; UPDATE space_memberships SET role='member',revoked_at=10; UPDATE account_sessions SET revoked_at=10,expires_at=0;");
  assert.deepEqual(JSON.parse(prepare().evidenceText).legacyDevices,evidence.legacyDevices);
  database.exec("UPDATE legacy_owner_claims SET session_id='other-session'");
  assert.throws(prepare,/relationships/);
  const mismatched=snapshot();
  assert.throws(()=>prepareLegacyErasureEvidence(mismatched,hash(mismatched),'other',providerIdentityDigest('https://fixture/','different')),/relationships/);
  database.exec("UPDATE legacy_owner_claims SET session_id='session'; UPDATE devices SET space_id='elsewhere' WHERE id='claimed'");
  assert.throws(prepare,/relationships/);
  database.exec("UPDATE devices SET space_id='shared' WHERE id='claimed'; UPDATE legacy_owner_claims SET claimed_at=2");
  assert.throws(prepare,/relationships/);
  database.exec("UPDATE legacy_owner_claims SET claimed_at=4; INSERT INTO personal_spaces VALUES ('shared','person',1000)");
  assert.throws(prepare,/relationships/);
  database.exec("DELETE FROM personal_spaces; UPDATE people SET issuer='urn:relay:erased',subject='"+identity+"' WHERE id='person'");
  assert.throws(prepare,/identity/);
  database.exec("UPDATE people SET issuer='https://fixture/',subject='subject' WHERE id='person'; ALTER TABLE legacy_owner_claims ADD COLUMN later_proof TEXT");
  assert.throws(prepare,/schema/);
} finally { database.close(); }
console.log('PASS: pinned historical claim evidence, exact identity/scope, no name inference, later revocation, inconsistent relationships and schema rejection.');
