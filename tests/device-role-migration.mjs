import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

// Exercise the additive migration against legacy records, including revoked and expired first devices.
const database = new DatabaseSync(':memory:');
try {
  for (const tag of ['0000_purple_chamber', '0001_late_beyonder', '0002_lush_karma']) database.exec(await readFile(`drizzle/${tag}.sql`, 'utf8'));
  database.exec("INSERT INTO spaces VALUES ('active', 'Active space', 0), ('inactive', 'Inactive space', 0)");
  const device = database.prepare('INSERT INTO devices (id,space_id,name,token_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,?,?)');
  device.run('revoked', 'active', 'Revoked', 'hash-1', 1, Date.now() + 60000, 10);
  device.run('expired', 'active', 'Expired', 'hash-2', 2, 1, null);
  device.run('first-active', 'active', 'First active', 'hash-3', 3, Date.now() + 60000, null);
  device.run('later-active', 'active', 'Later active', 'hash-4', 4, Date.now() + 60000, null);
  device.run('inactive-only', 'inactive', 'Expired only', 'hash-5', 1, 1, null);
  database.exec("INSERT INTO invitations (token_hash,space_id,expires_at) VALUES ('old-invitation','active',9999999999999)");
  database.exec(await readFile('drizzle/0003_device_roles.sql', 'utf8'));
  const owners = database.prepare("SELECT id FROM devices WHERE role = 'owner'").all();
  assert.deepEqual(owners.map(row => row.id), ['first-active']);
  assert.ok(database.prepare("SELECT redeemed_at FROM invitations WHERE token_hash = 'old-invitation'").get().redeemed_at);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 5);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS: legacy migration retains records, selects earliest active owner, skips inaccessible devices and invalidates issuerless invitations.');
} finally { database.close(); }
