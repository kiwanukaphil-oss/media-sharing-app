import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { backupCompletionQuery, inspectBackupCompletion } from '../scripts/inspect-backup-completion.mjs';
import { backupBucketId, backupPrefix } from '../scripts/backup-storage.mjs';

const snapshotId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`, id = randomUUID();
const prefix = `relay/snapshots/${snapshotId}/`;
const manifest = { action: 'upload', fileId: 'manifest-version', fileName: `${prefix}manifest.json`, sha256: 'a'.repeat(64), size: 500 };
const text = JSON.stringify({ snapshotId, status: 'copied-awaiting-restore', coordination: { formatVersion: 1, runId: id }, manifest });
const receiptDigest = createHash('sha256').update(text).digest('hex');
const run = { id, snapshotId, state: 'settled', receiptDigest };
const version = { action: 'upload', fileId: 'receipt-version', fileName: `${prefix}copy-receipt.json`, size: Buffer.byteLength(text), sha256: receiptDigest };
const catalog = { listingComplete: true, bucketId: backupBucketId, prefix: backupPrefix, versions: [manifest, version], unfinished: [] };
assert.ok(backupCompletionQuery(snapshotId).includes("a.kind='backup'"));
assert.throws(() => backupCompletionQuery("x'; DELETE FROM people; --"));
const result = await inspectBackupCompletion(snapshotId, async () => run, catalog, async () => text);
assert.equal(result.receiptMatches, true); assert.equal(result.quiescenceProven, false); assert.equal(result.cutoverAllowed, false);
assert.equal(result.verifiedReceiptVersions, 1);
const duplicateUpload = { ...catalog, versions: [...catalog.versions, { ...version, fileId: 'same-bytes-new-version' }] };
assert.equal((await inspectBackupCompletion(snapshotId, async () => run, duplicateUpload, async () => text)).verifiedReceiptVersions, 2);
for (const changed of [{ listingComplete: false }, { bucketId: 'other' }, { prefix: 'other/' }, { versions: [version] },
  { versions: [manifest, { ...version, action: 'hide' }] }, { versions: [manifest, { ...version, sha256: 'b'.repeat(64) }] },
  { versions: [manifest, version, version] }, { unfinished: [{ fileName: `${prefix}database.sql` }] }]) {
  await assert.rejects(inspectBackupCompletion(snapshotId, async () => run, { ...catalog, ...changed }, async () => text));
}
for (const state of ['active', 'uncertain']) await assert.rejects(inspectBackupCompletion(snapshotId, async () => ({ ...run, state }), catalog, async () => text));
await assert.rejects(inspectBackupCompletion(snapshotId, async () => run, catalog, async () => text + ' '), /bytes differ/);
let reads = 0;
await assert.rejects(inspectBackupCompletion(snapshotId, async () => (++reads === 1 ? run : { ...run, state: 'uncertain' }), catalog, async () => text), /changed/);
let ticks = 0;
await assert.rejects(inspectBackupCompletion(snapshotId, async () => run, catalog, async () => text, () => (++ticks === 1 ? 1000 : 32001)), /expired/);
console.log('PASS: independent current-run and all-version receipt inspection, immutable manifest binding, bounded freshness and rejection of incomplete/conflicting/unfinished evidence.');
