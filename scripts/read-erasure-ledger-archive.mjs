import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditErasureLedgerArchive,erasureArchivePrefix } from './audit-erasure-ledger-archive.mjs';
import { verifyErasureLedger } from './verify-erasure-ledger.mjs';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole,downloadBackupFile,operationsDirectory,storageRequest } from './backup-storage.mjs';

// Compare only this independent ledger's immutable catalog, retaining every upload/hide/version field.
// Unrelated original backups may progress without forcing the operator to repeat a ledger-only read.
function archiveCatalogFingerprint(catalog,root) {
  if(catalog?.listingComplete!==true || !Array.isArray(catalog.versions) || catalog.versions.some(record=>typeof record?.fileName!=='string'))
    throw new Error('Complete independent archive catalog required.');
  const records=catalog.versions.filter(record=>record.fileName.startsWith(erasureArchivePrefix(root)))
    .map(record=>({fileId:record.fileId,fileName:record.fileName,action:record.action,size:record.size,sha256:record.sha256}))
    .sort((left,right)=>left.fileName.localeCompare(right.fileName)||String(left.fileId).localeCompare(String(right.fileId)));
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

// The caller supplies an independently pinned public root and authenticated read-only archive transport.
// Inspect the full retained chain and repeat the catalog before timestamping the current head. Expired
// manifests remain historical audit only; no timestamp reset can make them valid current decisions.
export async function readCurrentErasureArchive(root,transport,clock=Date.now) {
  root=Object.freeze({...root});
  const before=await transport.catalog();
  const fingerprint=archiveCatalogFingerprint(before,root);
  const audit=await auditErasureLedgerArchive(before,root,transport.readPinned,clock());
  const after=await transport.catalog();
  if(archiveCatalogFingerprint(after,root)!==fingerprint) throw new Error('Independent ledger archive changed during verification.');
  const checkedAt=clock();
  const trust={...root,...audit.head,headCheckedAt:checkedAt};
  const ledger=verifyErasureLedger(audit.envelope,trust,checkedAt);
  return {source:'independent-backup-archive',cutoverAllowed:false,cloudErasureVerified:false,
    currentnessVerified:true,archiveFingerprint:fingerprint,versionsInspected:audit.versionsInspected,
    distinctRevisions:audit.distinctRevisions,trust,envelope:audit.envelope,ledger};
}

// Production transport reuses only the existing B2 reader. All downloaded decisions and opaque IDs stay
// in ignored private operations storage. The public root is operator-supplied, never read from app SQL.
async function saveCurrentArchiveRead(rootPath) {
  if(!rootPath) throw new Error('Independent public-root file required.');
  const root=JSON.parse(await readFile(rootPath,'utf8'));
  const reader=await authorizeBackupRole('reader');
  const directory=resolve(operationsDirectory,'erasure-archive-reads',randomUUID());
  await mkdir(directory,{recursive:true});let index=0;
  const report=await readCurrentErasureArchive(root,{
    catalog:()=>inventoryBackupVersions((operation,parameters)=>storageRequest(reader,operation,parameters)),
    readPinned:async record=>{
      const path=resolve(directory,`${index++}.revision.json`);
      await downloadBackupFile(reader,record,path);return readFile(path,'utf8');
    },
  });
  await writeFile(resolve(directory,'current-head.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'private-current-head-verified',revisions:report.distinctRevisions,
    versions:report.versionsInspected,cutoverAllowed:false,cloudErasureVerified:false}));
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {await saveCurrentArchiveRead(process.argv[2]);}
  catch {console.error('Current erasure archive unavailable or held for review; no restore clearance granted.');process.exitCode=1;}
}
