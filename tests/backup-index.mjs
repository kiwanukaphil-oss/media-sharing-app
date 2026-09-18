import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sealBackupIndex, openBackupIndex } from '../scripts/backup-index.mjs';

test('inventory artifact round-trips without exposing plaintext records', () => {
  const key = randomBytes(32);
  const index = { objects: [{ fileId: 'private-file-version-id', sha256: 'a'.repeat(64) }] };
  const encrypted = sealBackupIndex(index, key, 'run-1');
  assert.equal(encrypted.includes(Buffer.from('private-file-version-id')), false);
  assert.deepEqual(openBackupIndex(encrypted, key, 'run-1'), index);
});

test('modified, wrong-key, and cross-run inventories are rejected', () => {
  const key = randomBytes(32);
  const encrypted = sealBackupIndex({ objects: [] }, key, 'run-1');
  assert.throws(() => openBackupIndex(encrypted, randomBytes(32), 'run-1'));
  assert.throws(() => openBackupIndex(encrypted, key, 'run-2'));
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => openBackupIndex(damaged, key, 'run-1'));
});
