import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { inspectClosureSnapshot } from '../scripts/inspect-closure-snapshot.mjs';
import { inspectHistoricalSnapshot } from '../scripts/inventory-historical-snapshots.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from '../scripts/backup-d1-readonly.mjs';

const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
  for (const migration of journal.filter(entry => entry.idx <= 18)) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
  assert.equal(inspectClosureSnapshot(database).present, false);
  database.exec(await readFile('drizzle/0019_wild_nighthawk.sql', 'utf8'));
  database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at)
      VALUES ('person','fixture','subject','Name','fixture@example.invalid',1);
    INSERT INTO spaces VALUES ('shared','Shared',1);
    INSERT INTO space_memberships(id,person_id,space_id,role,created_at)
      VALUES ('member','person','shared','owner',1);
    INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at)
      VALUES ('linked','shared','Linked','linked-token',1,999),('unbound','shared','Unbound','unbound-token',1,999);
    INSERT INTO account_space_actors VALUES ('member','linked');
    INSERT INTO closure_write_admissions VALUES
      ('account','account','person',NULL,0,'settled',1,2),
      ('legacy','legacy',NULL,'linked',0,'active',1,NULL),
      ('unbound','legacy',NULL,'unbound',0,'uncertain',1,NULL),
      ('backup','backup',NULL,NULL,0,'active',1,NULL);
    INSERT INTO closure_backup_runs VALUES ('backup','own-snapshot',NULL,1);
    INSERT INTO closure_storage_effects VALUES
      ('capability','legacy','original/key','multipart_capability','multipart-id',1,2,'uncertain',1,NULL),
      ('completed','account','preview/key','put',NULL,NULL,NULL,'acknowledged',1,2);`);
  const before = database.prepare('SELECT * FROM closure_storage_effects ORDER BY id').all();
  const report = inspectClosureSnapshot(database);
  assert.equal(report.complete, true);
  assert.deepEqual(report.admissions.find(row => row.id === 'legacy').personIds, ['person']);
  assert.deepEqual(report.admissions.find(row => row.id === 'account').personIds, ['person']);
  assert.equal(report.admissions.find(row => row.id === 'backup').globalScope, true);
  assert.deepEqual(report.unboundLegacyAdmissionIds, ['unbound']);
  assert.deepEqual(report.unresolvedAdmissionIds, ['backup', 'legacy', 'unbound']);
  assert.deepEqual(report.unresolvedEffectIds, ['capability']);
  assert.equal(report.effects[0].upload_id, 'multipart-id');
  assert.equal(report.effects[0].capability_expires_at, 2, 'Expired capability evidence stays unresolved.');
  assert.equal(report.effects[1].object_key, 'preview/key', 'Acknowledged effects still retain sensitive references.');
  assert.equal(report.quiescenceProven, false);
  assert.equal(report.cutoverAllowed, false);
  const plan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
  const snapshot = restoreReadOnlySnapshot(plan, database.prepare(plan.sql).all());
  const historical = inspectHistoricalSnapshot(snapshot);
  assert.equal(historical.minimisationSchemaReviewed, false);
  assert.deepEqual(historical.closureProtocol, report);
  assert.deepEqual(database.prepare('SELECT * FROM closure_storage_effects ORDER BY id').all(), before);
  database.exec('DROP TABLE closure_backup_runs');
  const partial = inspectClosureSnapshot(database);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missingTables, ['closure_backup_runs']);
  assert.equal(partial.cutoverAllowed, false);
} finally { database.close(); }
console.log('PASS: private closure references, legacy attribution, global backups, unresolved capabilities and partial schema review.');
