import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { evaluateIdentityOperations, identityOperationsQuery } from '../scripts/check-identity-operations.mjs';

const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
  for (const migration of journal) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
  const inspect = () => evaluateIdentityOperations(database.prepare(identityOperationsQuery).all());
  assert.deepEqual(inspect(), []);
  database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at,credentials_changed_at)
    VALUES ('person','https://provider/','private-subject','Private name','private@example.test',1,100);
    INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at)
    VALUES ('session','person','secret-hash','config',1,9999999999999,100);
    INSERT INTO recovery_watermarks VALUES ('https://provider/','private-subject',100);`);
  assert.deepEqual(inspect(), [], 'Authentication at the reset watermark is current.');
  database.exec("UPDATE recovery_watermarks SET changed_at=200");
  assert.equal(inspect().length, 2, 'Detect both missed person reconciliation and stale sessions.');
  database.exec('UPDATE people SET credentials_changed_at=200; UPDATE account_sessions SET revoked_at=201');
  assert.deepEqual(inspect(), []);
  database.exec('UPDATE account_sessions SET revoked_at=NULL, expires_at=1');
  assert.deepEqual(inspect(), [], 'Expired sessions do not trigger active-access alerts.');
  database.exec('UPDATE account_sessions SET expires_at=9999999999999, authenticated_at=200; UPDATE people SET disabled_at=300');
  assert.equal(inspect().length, 1, 'Disabled people must not retain live sessions.');
  database.exec("UPDATE account_sessions SET revoked_at=301; INSERT INTO account_deletion_requests VALUES ('request','person',1,'pending',1)");
  assert.match(inspect()[0], /private operator review/);
  database.exec("UPDATE account_deletion_requests SET status='review_required'");
  assert.equal(inspect().length, 1, 'Restored requests must receive review.');
  database.exec("UPDATE account_deletion_requests SET status='withdrawn'");
  assert.deepEqual(inspect(), [], 'Withdrawn requests are not destructive work.');
  database.exec("UPDATE account_deletion_requests SET status='unexpected'");
  assert.match(inspect()[0], /Unrecognised/);
  assert.doesNotMatch(JSON.stringify(inspect()), /private@example|private-subject|secret-hash|Private name/);
  assert.throws(() => evaluateIdentityOperations([]), /incomplete/);
  assert.throws(() => evaluateIdentityOperations([{}]), /incomplete/);
  assert.throws(() => evaluateIdentityOperations([{requests_to_review:-1}]), /incomplete/);
  console.log('PASS: actual-schema operational queue, reset/session boundaries, disabled accounts and private failure output.');
} finally { database.close(); }
