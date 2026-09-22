import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { hashFile } from '../scripts/backup-storage.mjs';
import { persistBackupCompletionReceipt, verifyBackupCompletionReceipt } from '../scripts/backup-completion-receipt.mjs';
import { runCoordinatedBackup } from '../scripts/backup-closure-client.mjs';

const root = resolve('.sites-runtime/backup-completion-tests', randomUUID());
await mkdir(root, { recursive: true });
const snapshotId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
const manifest = { fileId: 'fixture-version', fileName: `relay/snapshots/${snapshotId}/manifest.json`, sha256: 'a'.repeat(64), size: 123 };
const receipt = { snapshotId, status: 'copied-awaiting-restore', manifest };
async function directory(name) { const path = join(root, name); await mkdir(path); return path; }
let archivedText, archivedVersion, expectedRun;
const events = [];
const successful = await directory('successful');
await runCoordinatedBackup(snapshotId, successful, async coordination => {
  assert.ok(Object.isFrozen(coordination));
  return persistBackupCompletionReceipt(successful, receipt, coordination, {}, async (_writer, path, fileName) => {
    events.push('archive');
    archivedText = await readFile(path, 'utf8');
    archivedVersion = { fileId: 'receipt-version', fileName, ...await hashFile(path) };
    return archivedVersion;
  });
}, async command => { events.push(command.action); if (command.action === 'settle') expectedRun = { ...command, state: command.outcome }; });
assert.deepEqual(events, ['begin', 'archive', 'settle']);
assert.deepEqual(JSON.parse(await readFile(join(successful, 'coordination-evidence-version.json'), 'utf8')), archivedVersion);
assert.equal(verifyBackupCompletionReceipt(archivedText, expectedRun, manifest).receiptMatches, true);
for (const changed of [{ state: 'active' }, { state: 'uncertain' }, { receiptDigest: 'b'.repeat(64) }, { id: randomUUID() }, { snapshotId: snapshotId.replace(/Z/, '0Z') }]) {
  assert.throws(() => verifyBackupCompletionReceipt(archivedText, { ...expectedRun, ...changed }, manifest));
}
assert.throws(() => verifyBackupCompletionReceipt(archivedText + ' ', expectedRun, manifest));
assert.throws(() => verifyBackupCompletionReceipt(archivedText, expectedRun, { ...manifest, fileId: 'another-version' }));
const failed = await directory('failed');
const outcomes = [];
await assert.rejects(runCoordinatedBackup(snapshotId, failed, coordination => persistBackupCompletionReceipt(failed, receipt,
  coordination, {}, async () => { throw new Error('archive interrupted'); }), async command => outcomes.push(command.outcome)), /interrupted/);
assert.deepEqual(outcomes, [undefined, 'uncertain']);
const mismatch = await directory('mismatch');
await assert.rejects(persistBackupCompletionReceipt(mismatch, receipt, { id: randomUUID(), snapshotId }, {},
  async () => ({ fileId: 'wrong', fileName: 'wrong', sha256: 'c'.repeat(64), size: 1 })), /does not match/);
let inactiveUploads = 0;
await persistBackupCompletionReceipt(await directory('inactive'), receipt, undefined, {}, async () => { inactiveUploads++; });
assert.equal(inactiveUploads, 0);
console.log('PASS: durable completion evidence before settlement, exact independent digest/run/manifest binding, interrupted archive uncertainty and unchanged inactive backup uploads.');
