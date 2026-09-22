import { inspectClosureSnapshot } from './inspect-closure-snapshot.mjs';
import { inspectBackupCompletion } from './inspect-backup-completion.mjs';

// Historical active/uncertain rows are not current writer state. Reconcile each exact global run using
// independent live D1 and immutable B2 readers, without changing restored rows or lifting quarantine.
// This reports receipt custody only; global fencing and retained object/provider disposition stay separate.
export async function reviewRestoredBackupRuns(database, readCurrentRun, catalog, downloadText, clock = Date.now) {
  const protocol = inspectClosureSnapshot(database);
  if (!protocol.complete || protocol.orphanBackupIds.length || protocol.orphanEffectIds.length ||
      protocol.backups.length > 1000) throw new Error('Complete bounded restored protocol inventory required.');
  const global = protocol.admissions.filter(row => row.kind === 'backup');
  if (global.length !== protocol.backups.length) throw new Error('Restored backup admission bindings require review.');
  const reconciled = [];
  for (const backup of protocol.backups) {
    const admission = global.find(row => row.id === backup.id);
    if (!admission || admission.person_id !== null || admission.device_id !== null || admission.generation !== 0 ||
        !['active', 'uncertain', 'settled'].includes(admission.state) ||
        protocol.effects.some(effect => effect.admission_id === admission.id)) throw new Error('Restored global backup scope requires review.');
    const result = await inspectBackupCompletion(backup.snapshot_id, readCurrentRun, catalog, downloadText, clock);
    if (result.runId !== backup.id) throw new Error('Current backup run differs from restored binding.');
    // A completed historical digest cannot change; an earlier active snapshot may legitimately lack it.
    if (backup.receipt_digest !== null && backup.receipt_digest !== result.receiptDigest) {
      throw new Error('Historical completion evidence conflicts with current receipt.');
    }
    reconciled.push({runId:backup.id,snapshotId:backup.snapshot_id,historicalState:admission.state,
      receiptVersions:result.verifiedReceiptVersions,receiptDigest:result.receiptDigest,observedAt:result.observedAt});
  }
  if (JSON.stringify(inspectClosureSnapshot(database)) !== JSON.stringify(protocol)) throw new Error('Restored inventory changed during review.');
  return {mode:'restored-backup-reconciliation-review',runs:reconciled,
    currentCompletionReceiptsVerified:true,restoredStateChanged:false,
    quiescenceProven:false,executable:false,cutoverAllowed:false};
}
