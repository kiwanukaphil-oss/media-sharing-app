import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,readErasureJournal } from './erasure-ledger-journal.mjs';

export const erasureArchivePrefix=root=>`relay/erasure-ledger/journal/${root.ledgerId}/`;

// Export only independently audited, signed decision evidence; no signer credential enters an archive.
// Names bind a revision and payload digest. Individual immutable uploads retain the complete history.
export function prepareErasureArchiveEntries(database,root,now=Date.now()) {
  const verified=readErasureJournal(database,root,now);
  const entries=database.prepare('SELECT * FROM ledger_revisions ORDER BY revision').all().map(row=>{
    const body=JSON.stringify({formatVersion:1,revision:row.revision,payloadDigest:row.payload_digest,
      previousDigest:row.previous_digest,envelope:JSON.parse(row.envelope),journalSignature:row.journal_signature});
    return {revision:row.revision,fileName:`${erasureArchivePrefix(root)}${String(row.revision).padStart(8,'0')}-${row.payload_digest}.json`,
      sha256:createHash('sha256').update(body).digest('hex'),size:Buffer.byteLength(body),body};
  });
  return {head:verified.head,entries,cutoverAllowed:false};
}

// Inspect every retained immutable version under the independently selected root. Never trust the latest
// filename alone: replayed old uploads cannot roll back a head, and competing signed revisions fail closed.
// Actual B2 transport/currentness is a separate adapter; this pure audit grants no restore clearance.
export async function auditErasureLedgerArchive(catalog,root,readPinned,now=Date.now()) {
  if(catalog?.listingComplete!==true || !Array.isArray(catalog.versions) || catalog.versions.some(record=>typeof record?.fileName!=='string'))
    throw new Error('Complete ledger archive catalog required.');
  const prefix=erasureArchivePrefix(root);
  const records=catalog.versions.filter(record=>typeof record.fileName==='string' && record.fileName.startsWith(prefix));
  if(!records.length || records.length>10000) throw new Error('Ledger archive is empty or exceeds its reviewed bound.');
  const database=new DatabaseSync(':memory:');
  try {
    initialiseErasureJournal(database,root);
    const versions=new Set(),revisions=new Map();let totalBytes=0;
    for(const record of records) {
      const suffix=record.fileName.slice(prefix.length),match=/^(\d{8})-([a-f0-9]{64})\.json$/.exec(suffix);
      totalBytes+=record.size;
      if(record.action!=='upload' || !match || !Number.isSafeInteger(record.size) || record.size<=0 || record.size>2*1024*1024 ||
          totalBytes>32*1024*1024 || typeof record.fileId!=='string' || !record.fileId || versions.has(record.fileId) ||
          typeof record.sha256!=='string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Ledger archive version requires review.');
      versions.add(record.fileId);
      const text=await readPinned(record);
      if(typeof text!=='string' || Buffer.byteLength(text)!==record.size || createHash('sha256').update(text).digest('hex')!==record.sha256)
        throw new Error('Ledger archive bytes differ from the pinned version.');
      const entry=JSON.parse(text);
      if(JSON.stringify(entry)!==text || Object.keys(entry).sort().join(',')!==['formatVersion','revision','payloadDigest','previousDigest','envelope','journalSignature'].sort().join(',') ||
          entry.formatVersion!==1 || entry.revision!==Number(match[1]) || entry.revision<1 || entry.revision>10000 || entry.payloadDigest!==match[2])
        throw new Error('Ledger archive entry is ambiguous.');
      const previous=revisions.get(entry.revision);
      if(previous && previous!==text) throw new Error('Competing ledger revisions require operator review.');
      if(previous) continue;
      revisions.set(entry.revision,text);
      database.prepare('INSERT INTO ledger_revisions VALUES (?,?,?,?,?)').run(entry.revision,entry.payloadDigest,entry.previousDigest,JSON.stringify(entry.envelope),entry.journalSignature);
    }
    const last=database.prepare('SELECT revision,payload_digest AS payloadDigest,envelope FROM ledger_revisions ORDER BY revision DESC LIMIT 1').get();
    database.prepare('UPDATE ledger_head SET revision=?,payload_digest=? WHERE id=1').run(last.revision,last.payloadDigest);
    const audit=readErasureJournal(database,root,now);
    return {mode:'archive-audit',cutoverAllowed:false,currentnessVerified:false,head:audit.head,ledger:audit.ledger,
      envelope:JSON.parse(last.envelope),versionsInspected:records.length,distinctRevisions:revisions.size};
  } finally {database.close();}
}
