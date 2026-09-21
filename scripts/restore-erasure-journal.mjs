import { mkdir,open,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { auditErasureLedgerArchive } from './audit-erasure-ledger-archive.mjs';
import { initialiseErasureJournal,readErasureJournal } from './erasure-ledger-journal.mjs';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole,downloadBackupFile,operationsDirectory,storageRequest } from './backup-storage.mjs';

// Recover authenticated history into a separate empty database, never over an operational journal.
// Audit every pinned version first. Expired history is recoverable but cannot grant current clearance;
// the operator must separately reconcile the archive head and live intent before activating any writer.
export async function restoreErasureJournal(database,root,catalog,readPinned,now=Date.now()) {
  root=Object.freeze({...root});
  if(database.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get().n)
    throw new Error('Journal recovery requires a new empty database.');
  const bodies=[];
  const audit=await auditErasureLedgerArchive(catalog,root,async record=>{
    const text=await readPinned(record);
    // Parse only after the archive auditor validates bounded bytes and duplicate consistency.
    bodies.push(text);return text;
  },now);
  if(database.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get().n)
    throw new Error('Journal recovery destination changed during archive audit.');
  const entries=new Map(bodies.map(text=>{const entry=JSON.parse(text);return [entry.revision,entry];}));
  initialiseErasureJournal(database,root);
  database.exec('BEGIN IMMEDIATE');
  try {
    for(const entry of [...entries.values()].sort((a,b)=>a.revision-b.revision))
      database.prepare('INSERT INTO ledger_revisions VALUES (?,?,?,?,?)').run(entry.revision,entry.payloadDigest,
        entry.previousDigest,JSON.stringify(entry.envelope),entry.journalSignature);
    database.prepare('UPDATE ledger_head SET revision=?,payload_digest=? WHERE id=1').run(audit.head.revision,audit.head.payloadDigest);
    const restored=readErasureJournal(database,root,now);
    if(restored.head.revision!==audit.head.revision || restored.head.payloadDigest!==audit.head.payloadDigest)
      throw new Error('Recovered journal differs from independently audited history.');
    database.exec('COMMIT');
    return {mode:'recovered-history-review',head:restored.head,records:restored.ledger.records.length,
      revisions:audit.distinctRevisions,currentnessVerified:false,writerActivated:false,cutoverAllowed:false};
  } catch(failure) {database.exec('ROLLBACK');throw failure;}
}

// Use only the existing read-only cloud role and the separately pinned repository public root.
// The recovered journal stays in a unique private review directory; no signing key is accessed and
// neither the application database nor the operational journal is opened by this command.
async function saveRecoveredJournal() {
  const root=JSON.parse(await readFile('deploy/erasure-ledger-public-root.json','utf8'));
  const reader=await authorizeBackupRole('reader');
  const directory=resolve(operationsDirectory,'erasure-journal-recoveries',randomUUID());
  await mkdir(directory,{recursive:true});
  const destination=resolve(directory,'recovered-journal.sqlite');
  const reserved=await open(destination,'wx',0o600);await reserved.close();
  const database=new DatabaseSync(destination);let index=0;
  try {
    const catalog=await inventoryBackupVersions((operation,parameters)=>storageRequest(reader,operation,parameters));
    const report=await restoreErasureJournal(database,root,catalog,async record=>{
      const path=resolve(directory,`${index++}.revision.json`);
      await downloadBackupFile(reader,record,path);return readFile(path,'utf8');
    });
    await writeFile(resolve(directory,'verification.json'),JSON.stringify({...report,verifiedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({status:'independent-journal-history-restored',revisions:report.revisions,
      records:report.records,currentnessVerified:false,writerActivated:false,cutoverAllowed:false}));
  } finally {database.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {await saveRecoveredJournal();}
  catch {console.error('Journal recovery held for review; existing journals unchanged and no writer activated.');process.exitCode=1;}
}
