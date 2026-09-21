import { createHash } from 'node:crypto';
import { prepareErasureArchiveEntries,auditErasureLedgerArchive,erasureArchivePrefix } from './audit-erasure-ledger-archive.mjs';
import { recordErasureIntents } from './record-erasure-intents.mjs';
import { readCurrentErasureArchive } from './read-erasure-ledger-archive.mjs';

const fingerprint=source=>createHash('sha256').update(JSON.stringify(source)).digest('hex');

// Before publishing, every existing immutable archive version must belong to local authenticated history.
// A remote lead/fork, hidden version or mismatched bytes requires recovery/review, never automatic overwrite.
async function verifyExistingArchive(database,root,transport,now) {
  const prepared=prepareErasureArchiveEntries(database,root,now),catalog=await transport.catalog();
  if(catalog.listingComplete!==true || !Array.isArray(catalog.versions) ||
      catalog.versions.some(row=>typeof row.fileName!=='string')) throw new Error('Complete archive catalog required.');
  const existing=catalog.versions.filter(row=>row.fileName.startsWith(erasureArchivePrefix(root)));
  if(existing.length) {
    const remote=await auditErasureLedgerArchive(catalog,root,transport.readPinned,now);
    if(!prepared.entries.some(entry=>entry.revision===remote.head.revision && JSON.parse(entry.body).payloadDigest===remote.head.payloadDigest))
      throw new Error('Remote journal is ahead or diverged; restore/review required.');
    if(existing.some(row=>!prepared.entries.some(entry=>entry.fileName===row.fileName && entry.sha256===row.sha256)))
      throw new Error('Remote archive bytes differ from local authenticated history.');
  }
  return {prepared,existing};
}

// The caller holds the host's exclusive writer lock throughout this operation. Record observed intent,
// upload missing immutable versions, verify the complete independent head, and re-read live intent.
// Failure retains a signed/uploaded prefix for retry, but never reports synchronization or erasure success.
export async function publishErasureIntents(database,root,privateKey,readSource,issuer,transport,clock=Date.now) {
  root=Object.freeze({...root});
  await verifyExistingArchive(database,root,transport,clock());
  const observedAt=clock(),source=await readSource();
  const sourceDigest=fingerprint(source);
  if(fingerprint(await readSource())!==sourceDigest) throw new Error('Live intent changed before recording.');
  const recorded=recordErasureIntents(database,root,privateKey,source,issuer,observedAt,clock());
  const {prepared,existing}=await verifyExistingArchive(database,root,transport,clock());
  for(const entry of prepared.entries) {
    if(existing.some(row=>row.fileName===entry.fileName && row.sha256===entry.sha256)) continue;
    await transport.upload(entry);
  }
  const verified=await readCurrentErasureArchive(root,transport,clock);
  if(verified.trust.revision!==recorded.head.revision || verified.trust.payloadDigest!==recorded.head.payloadDigest)
    throw new Error('Published intent head differs from independent readback.');
  if(fingerprint(await readSource())!==sourceDigest || clock()-observedAt>30000)
    throw new Error('Intent changed or observation expired during publication; reconcile before use.');
  return {...verified,observedAt,sourceDigest,requestCount:source.requests.length,
    intentObservedConsistent:true,writeFreezeVerified:false,realErasurePerformed:false};
}
