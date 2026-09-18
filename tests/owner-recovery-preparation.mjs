import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Inspect a prepared credential without applying it to any live or persistent database.
const spaceId = randomUUID();
const prepared = spawnSync(process.execPath, ['scripts/prepare-owner-recovery.mjs', spaceId], { encoding: 'utf8' });
assert.equal(prepared.status, 0);
const directory = prepared.stdout.match(/Prepared private recovery files in (.+)\. No database/)[1];
const credential = JSON.parse(await readFile(join(directory, 'credential.json'), 'utf8'));
const sql = await readFile(join(directory, 'recovery.sql'), 'utf8');
assert.match(credential.token, /^[a-f0-9]{64}$/);
assert.equal(credential.spaceId, spaceId);
assert.ok(credential.expiresAt > Date.now() && credential.expiresAt <= Date.now() + 30 * 60 * 1000);
assert.ok(!sql.includes(credential.token) && !prepared.stdout.includes(credential.token));
const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
  for (const migration of journal.entries) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
  database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?,?,?)').run(spaceId, 'Recovery test only', Date.now());
  database.exec(sql);
  const device = database.prepare('SELECT * FROM devices').get();
  assert.equal(device.id, credential.deviceId);
  assert.equal(device.space_id, spaceId);
  assert.equal(device.role, 'owner');
  assert.equal(device.token_hash, createHash('sha256').update(credential.token).digest('hex'));
  assert.equal(device.expires_at, credential.expiresAt);
  assert.throws(() => database.exec(sql), /UNIQUE/);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
} finally { database.close(); }
assert.notEqual(spawnSync(process.execPath, ['scripts/prepare-owner-recovery.mjs', "bad'; SQL"], { encoding: 'utf8' }).status, 0);
console.log('PASS: recovery preparation stays local, validates space IDs, hashes tokens, scopes the temporary owner and expires it within thirty minutes.');
