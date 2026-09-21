import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { checkDatabase, completedOriginals, sanitizeRestoredAccess } from '../scripts/relay-backup.mjs';
import { backupBucketId, validateFileDigest, validateKeyScope } from '../scripts/backup-storage.mjs';

// A restored fixture includes Trash, an unfinished upload, a live device, and a redeemable invitation.
function recoveryFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE spaces(id TEXT PRIMARY KEY);
    CREATE TABLE devices(id TEXT PRIMARY KEY, space_id TEXT REFERENCES spaces(id), revoked_at INTEGER, expires_at INTEGER);
    CREATE TABLE invitations(id TEXT PRIMARY KEY, expires_at INTEGER, redeemed_at INTEGER);
    CREATE TABLE media(id TEXT PRIMARY KEY, object_key TEXT, size INTEGER, sha256 TEXT, status TEXT,
      archived_at INTEGER, preview_ready INTEGER, preview_size INTEGER);
    INSERT INTO spaces VALUES('space');
    INSERT INTO devices VALUES('device','space',NULL,9999999999999);
    INSERT INTO invitations VALUES('invite',9999999999999,NULL);
    INSERT INTO media VALUES('trash','space/original',4,'${'a'.repeat(64)}','ready',123,1,10);
    INSERT INTO media VALUES('pending','space/pending',4,'${'b'.repeat(64)}','uploading',NULL,0,0);
  `);
  return database;
}

test('complete originals include Trash and exclude unfinished uploads', () => {
  const database = recoveryFixture();
  try { assert.deepEqual(completedOriginals(database).map(row => row.id), ['trash']); }
  finally { database.close(); }
});

test('restoration holds pending deletion requests without reviving withdrawn intent', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE account_deletion_requests(id TEXT PRIMARY KEY,status TEXT,updated_at INTEGER); INSERT INTO account_deletion_requests VALUES('pending','pending',1),('withdrawn','withdrawn',2)");
    sanitizeRestoredAccess(database, 12345);
    assert.equal(database.prepare("SELECT status FROM account_deletion_requests WHERE id='pending'").get().status, 'review_required');
    assert.equal(database.prepare("SELECT status FROM account_deletion_requests WHERE id='withdrawn'").get().status, 'withdrawn');
  } finally { database.close(); }
});

test('restoration invalidates device and invitation access while preserving records', () => {
  const database = recoveryFixture();
  try {
    sanitizeRestoredAccess(database, 12345);
    assert.equal(database.prepare('SELECT revoked_at FROM devices').get().revoked_at, 12345);
    assert.equal(database.prepare('SELECT expires_at FROM invitations').get().expires_at, 0);
    assert.equal(database.prepare("SELECT status FROM media WHERE id='pending'").get().status, 'cancelling');
    assert.equal(database.prepare('SELECT SUM(preview_size) AS n FROM media').get().n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM devices').get().n, 1);
    checkDatabase(database);
  } finally { database.close(); }
});

test('broken relationships fail restore validation', () => {
  const database = recoveryFixture();
  try {
    database.exec("PRAGMA foreign_keys=OFF; UPDATE devices SET space_id='missing'");
    assert.throws(() => checkDatabase(database), /relationship/);
  } finally { database.close(); }
});

test('restoration discards pending sign-in attempts so consumed callbacks cannot revive', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE auth_transactions(state_hash TEXT PRIMARY KEY, verifier TEXT); INSERT INTO auth_transactions VALUES('old-state','old-verifier')");
    sanitizeRestoredAccess(database, 12345);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_transactions').get().n, 0);
  } finally { database.close(); }
});

test('restoration revokes account sessions without deleting person records', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE account_sessions(id TEXT PRIMARY KEY, revoked_at INTEGER, expires_at INTEGER); INSERT INTO account_sessions VALUES('old-session',NULL,9999999999999)");
    sanitizeRestoredAccess(database, 12345);
    assert.deepEqual({ ...database.prepare('SELECT * FROM account_sessions').get() }, { id: 'old-session', revoked_at: 12345, expires_at: 0 });
  } finally { database.close(); }
});

test('restoration invalidates pending ownership claims', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE owner_claim_attempts(token_hash TEXT PRIMARY KEY, consumed_at INTEGER, expires_at INTEGER); INSERT INTO owner_claim_attempts VALUES('pending',NULL,9999999999999)");
    sanitizeRestoredAccess(database, 12345);
    assert.deepEqual({ ...database.prepare('SELECT * FROM owner_claim_attempts').get() }, { token_hash: 'pending', consumed_at: 12345, expires_at: 0 });
  } finally { database.close(); }
});

test('incorrect bytes cannot pass file verification', () => {
  assert.throws(() => validateFileDigest({ size: 4, sha256: 'a' }, { size: 4, sha256: 'b' }), /mismatch/);
  assert.throws(() => validateFileDigest({ size: 3, sha256: 'a' }, { size: 4, sha256: 'a' }), /mismatch/);
});

test('restoration cannot revive removed memberships or person invitations from an older snapshot', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE space_memberships(id TEXT PRIMARY KEY, revoked_at INTEGER); INSERT INTO space_memberships VALUES('formerly-active',NULL),('already-revoked',123)");
    database.exec("CREATE TABLE person_invitations(id TEXT PRIMARY KEY, revoked_at INTEGER, expires_at INTEGER); INSERT INTO person_invitations VALUES('old-invite',NULL,9999999999999)");
    sanitizeRestoredAccess(database, 12345);
    assert.equal(database.prepare("SELECT revoked_at FROM space_memberships WHERE id='formerly-active'").get().revoked_at, 12345);
    assert.equal(database.prepare("SELECT revoked_at FROM space_memberships WHERE id='already-revoked'").get().revoked_at, 123);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM space_memberships').get().n, 2);
    assert.equal(database.prepare('SELECT expires_at FROM person_invitations').get().expires_at, 0);
  } finally { database.close(); }
});

test('credentials with deletion or broader bucket access are rejected', () => {
  const allowed = { capabilities: ['writeFiles'], buckets: [{ id: backupBucketId }], namePrefix: 'relay/' };
  assert.doesNotThrow(() => validateKeyScope(allowed, 'writer'));
  assert.throws(() => validateKeyScope({ ...allowed, capabilities: ['writeFiles', 'deleteFiles'] }, 'writer'), /scope/);
  assert.throws(() => validateKeyScope({ ...allowed, buckets: [] }, 'writer'), /scope/);
  assert.throws(() => validateKeyScope({ ...allowed, namePrefix: '' }, 'writer'), /scope/);
});

test('restoration prevents unfinished publication from resuming and preserves completed evidence', () => {
  const database = recoveryFixture();
  try {
    database.exec("CREATE TABLE publications(id TEXT PRIMARY KEY, phase TEXT, lease_expires_at INTEGER); INSERT INTO publications VALUES('in-flight','copying',9999999999999),('finished','ready',0)");
    sanitizeRestoredAccess(database, 12345);
    assert.deepEqual({ ...database.prepare("SELECT phase,lease_expires_at FROM publications WHERE id='in-flight'").get() }, { phase: 'cancelling', lease_expires_at: 0 });
    assert.equal(database.prepare("SELECT phase FROM publications WHERE id='finished'").get().phase, 'ready');
  } finally { database.close(); }
});

test('restoration quarantines closure and interrupted backup/storage work without inventing completion', () => {
  const database=new DatabaseSync(':memory:');
  try {
    // Apply actual reviewed migrations plus the isolated protocol, not a simplified schema imitation.
    const migrations=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
    for(const path of [...migrations.map(row=>`drizzle/${row.tag}.sql`),'deploy/closure-fence-prototype.sql'])database.exec(readFileSync(path,'utf8'));
    database.exec(`INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES('person','https://fixture.invalid/','fixture','Fixture','fixture@example.invalid',1);
      INSERT INTO account_deletion_requests VALUES('request','person',1,'review_required',2);
      INSERT INTO closure_fences VALUES('fence','person','request',1,1,'draining','plan','decision','approval',2);
      INSERT INTO closure_write_admissions(id,kind,person_id,generation,state,started_at) VALUES('account','account','person',0,'active',1);
      INSERT INTO closure_write_admissions(id,kind,generation,state,started_at) VALUES('backup','backup',0,'active',1),('finished','backup',0,'settled',1);
      INSERT INTO closure_backup_runs VALUES('backup','snapshot',NULL,1),('finished','older','receipt',1);
      INSERT INTO closure_storage_effects(id,admission_id,object_key,operation,state,started_at) VALUES
        ('effect','account','fixture/object','put','active',1),('old-effect','finished','fixture/old','put','acknowledged',1);`);
    sanitizeRestoredAccess(database,12345);
    assert.equal(database.prepare('SELECT phase FROM closure_fences').get().phase,'review_required');
    assert.equal(database.prepare('SELECT disabled_at FROM people').get().disabled_at,12345);
    assert.deepEqual(database.prepare('SELECT state FROM closure_write_admissions ORDER BY id').all().map(row=>row.state),['uncertain','uncertain','settled']);
    assert.deepEqual(database.prepare('SELECT state FROM closure_storage_effects ORDER BY id').all().map(row=>row.state),['uncertain','acknowledged']);
    assert.equal(database.prepare("SELECT receipt_digest FROM closure_backup_runs WHERE id='backup'").get().receipt_digest,null);
    assert.equal(database.prepare("SELECT receipt_digest FROM closure_backup_runs WHERE id='finished'").get().receipt_digest,'receipt');
    sanitizeRestoredAccess(database,12346);
    assert.equal(database.prepare('SELECT disabled_at FROM people').get().disabled_at,12345);
    checkDatabase(database);
  } finally {database.close();}
});

test('partial closure schema cannot silently pass recovery sanitisation', () => {
  const database=recoveryFixture();
  try {
    database.exec('CREATE TABLE closure_fences(id TEXT PRIMARY KEY)');
    assert.throws(()=>sanitizeRestoredAccess(database,12345),/Incomplete closure schema/);
    assert.equal(database.prepare('SELECT revoked_at FROM devices').get().revoked_at,null,'Failed review rolls back the entire sanitisation transaction');
  } finally {database.close();}
});
