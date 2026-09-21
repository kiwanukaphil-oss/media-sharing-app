import { verifiedErasureReceipt } from './verify-erasure-ledger.mjs';
import { minimiseErasedSnapshot } from './minimise-erased-snapshot.mjs';

// Verify outside the restored database before invoking the isolated rehearsal helper. Never accept the
// snapshot itself as the trust source. This wrapper deliberately cannot enable production cutover.
export function reconcileErasedSnapshot(sql, envelope, independentTrust, personId, now = Date.now()) {
  const receipt = verifiedErasureReceipt(envelope, independentTrust, personId, now);
  return { ...minimiseErasedSnapshot(sql, receipt, now), ledgerAuthenticated: true,
    ledgerRevision: independentTrust.revision, ledgerPayloadDigest: independentTrust.payloadDigest };
}
