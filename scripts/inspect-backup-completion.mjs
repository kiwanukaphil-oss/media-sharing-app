import { createHash } from 'node:crypto';
import { verifyBackupCompletionReceipt } from './backup-completion-receipt.mjs';
import { backupBucketId, backupPrefix } from './backup-storage.mjs';

const snapshotPattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const digest = text => createHash('sha256').update(text).digest('hex');

// Query only a validated exact snapshot. Supply a live authenticated D1 reader; a restored database is
// not an independent source for deciding whether the backup captured in it eventually finished.
export function backupCompletionQuery(snapshotId) {
  if (!snapshotPattern.test(snapshotId)) throw new Error('Exact backup snapshot ID is required.');
  return `SELECT a.id,a.state,b.snapshot_id AS snapshotId,b.receipt_digest AS receiptDigest
    FROM closure_backup_runs b JOIN closure_write_admissions a ON a.id=b.id
    WHERE a.kind='backup' AND b.snapshot_id='${snapshotId}'`;
}

// Resolve only immutable versions in a complete independently read B2 catalog. Re-read current D1
// around byte verification; conflicting receipts, missing versions or changed state retain review.
// This validates completion evidence, never a global write freeze or permission to remove backups.
export async function inspectBackupCompletion(snapshotId, readCurrentRun, catalog, downloadText, clock = Date.now) {
  backupCompletionQuery(snapshotId);
  const startedAt = clock(), run = await readCurrentRun(snapshotId);
  if (run?.snapshotId !== snapshotId || run.state !== 'settled' || !/^[a-f0-9]{64}$/.test(run.receiptDigest ?? '') ||
      catalog?.listingComplete !== true || catalog.bucketId !== backupBucketId || catalog.prefix !== backupPrefix ||
      !Array.isArray(catalog.versions) || !Array.isArray(catalog.unfinished)) throw new Error('Independent completion evidence is incomplete.');
  const prefix = `relay/snapshots/${snapshotId}/`, receiptName = `${prefix}copy-receipt.json`;
  if (catalog.unfinished.some(row => row.fileName?.startsWith(prefix))) throw new Error('Snapshot has unfinished backup writes.');
  const candidates = catalog.versions.filter(row => row.fileName === receiptName);
  if (!candidates.length || candidates.some(row => row.action !== 'upload' || row.sha256 !== run.receiptDigest ||
      !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > 16384 || typeof row.fileId !== 'string' || !row.fileId) ||
      new Set(candidates.map(row => row.fileId)).size !== candidates.length) throw new Error('Snapshot completion versions require review.');
  let verified;
  for (const candidate of candidates) {
    const text = await downloadText(candidate);
    if (typeof text !== 'string' || Buffer.byteLength(text) !== candidate.size || digest(text) !== run.receiptDigest) {
      throw new Error('Downloaded backup completion bytes differ.');
    }
    let receipt;
    try { receipt = JSON.parse(text); } catch { throw new Error('Backup completion evidence is invalid.'); }
    const manifests = catalog.versions.filter(row => row.fileName === `${prefix}manifest.json` &&
      row.fileId === receipt?.manifest?.fileId && row.action === 'upload');
    if (manifests.length !== 1) throw new Error('Pinned manifest version is missing or ambiguous.');
    verified = verifyBackupCompletionReceipt(text, run, manifests[0]);
  }
  const finalRun = await readCurrentRun(snapshotId), finishedAt = clock();
  if (JSON.stringify(finalRun) !== JSON.stringify(run) || !Number.isSafeInteger(startedAt) ||
      !Number.isSafeInteger(finishedAt) || finishedAt < startedAt || finishedAt - startedAt > 30000) throw new Error('Current backup completion observation changed or expired.');
  return { ...verified, verifiedReceiptVersions: candidates.length, currentRunUnchanged: true,
    receiptDigest: run.receiptDigest, mode: 'independent-completion-review', observedAt: finishedAt };
}
