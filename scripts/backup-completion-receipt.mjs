import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hashFile, uploadBackupFile } from './backup-storage.mjs';

const snapshotPattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const runPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// The expected run/digest must come from a current independently read coordinator, never the restored
// SQL or this evidence itself. Matching proves exact receipt custody, not physical erasure or quiescence.
export function verifyBackupCompletionReceipt(text, expectedRun, manifestVersion) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16384 || expectedRun?.state !== 'settled' ||
      !runPattern.test(expectedRun.id ?? '') || !snapshotPattern.test(expectedRun.snapshotId ?? '') ||
      !/^[a-f0-9]{64}$/.test(expectedRun.receiptDigest ?? '') ||
      createHash('sha256').update(text).digest('hex') !== expectedRun.receiptDigest) {
    throw new Error('Current independent backup receipt binding is required.');
  }
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw new Error('Backup receipt JSON is invalid.'); }
  const manifestName = `relay/snapshots/${expectedRun.snapshotId}/manifest.json`;
  if (receipt?.snapshotId !== expectedRun.snapshotId || receipt.status !== 'copied-awaiting-restore' ||
      receipt.coordination?.formatVersion !== 1 || receipt.coordination.runId !== expectedRun.id ||
      !manifestVersion || typeof manifestVersion.fileId !== 'string' || !manifestVersion.fileId ||
      manifestVersion.fileName !== manifestName || !/^[a-f0-9]{64}$/.test(manifestVersion.sha256 ?? '') ||
      !Number.isSafeInteger(manifestVersion.size) || manifestVersion.size < 0 ||
      ['fileId', 'fileName', 'sha256', 'size'].some(field => receipt.manifest?.[field] !== manifestVersion[field])) {
    throw new Error('Backup receipt does not bind the exact run and manifest version.');
  }
  return { receiptMatches: true, runId: expectedRun.id, snapshotId: expectedRun.snapshotId,
    quiescenceProven: false, cutoverAllowed: false };
}

// Archive the exact digest acknowledged to the coordinator before settlement. A GitHub runner's local
// receipt disappears after its job, so coordinated completion evidence must also survive in B2.
// This records writer completion; independent restoration and current writer fencing remain separate.
export async function persistBackupCompletionReceipt(directory, receipt, coordination, writer, upload = uploadBackupFile) {
  if (!snapshotPattern.test(receipt?.snapshotId ?? '') || (coordination &&
      (!runPattern.test(coordination.id ?? '') || coordination.snapshotId !== receipt.snapshotId))) {
    throw new Error('Backup completion receipt scope is invalid.');
  }
  const evidence = coordination ? { ...receipt, coordination: { formatVersion: 1, runId: coordination.id } } : receipt;
  const path = join(directory, 'copy-receipt.json');
  await writeFile(path, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  const digest = await hashFile(path);
  if (coordination) {
    const fileName = `relay/snapshots/${receipt.snapshotId}/copy-receipt.json`;
    const archived = await upload(writer, path, fileName);
    if (archived?.fileName !== fileName || typeof archived.fileId !== 'string' || !archived.fileId ||
        archived.sha256 !== digest.sha256 || archived.size !== digest.size) {
      throw new Error('Archived backup completion receipt does not match.');
    }
    await writeFile(join(directory, 'coordination-evidence-version.json'), JSON.stringify(archived), { flag: 'wx', mode: 0o600 });
  }
  return digest;
}
