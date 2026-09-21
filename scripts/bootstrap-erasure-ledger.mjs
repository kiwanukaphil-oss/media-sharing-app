import { createHash,createPrivateKey,createPublicKey,sign } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,readErasureJournal,appendErasureJournal,journalSigningBytes } from './erasure-ledger-journal.mjs';
import { auditErasureLedgerArchive,erasureArchivePrefix,prepareErasureArchiveEntries } from './audit-erasure-ledger-archive.mjs';
import { readCurrentErasureArchive } from './read-erasure-ledger-archive.mjs';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole,downloadBackupFile,operationsDirectory,runPrivateCommand,uploadBackupFile } from './backup-storage.mjs';

// Bootstrap can sign only an empty decision set, including freshness renewal while setup is unfinished.
// Once a real decision exists, this entry point refuses to act; it cannot replace or fulfil a request.
export function prepareEmptyErasureLedger(database,root,privateKey,now=Date.now()) {
  if(createPublicKey(privateKey).export({type:'spki',format:'pem'})!==root.publicKey) throw new Error('Signing key differs from public root.');
  initialiseErasureJournal(database,root);
  const current=readErasureJournal(database,root,now);
  if(current.ledger?.records.length) throw new Error('A populated ledger requires the reviewed transition workflow.');
  if(current.ledger && current.ledger.expiresAt>now+300000) return prepareErasureArchiveEntries(database,root,now);
  const revision=current.head.revision+1;
  const payload=Buffer.from(JSON.stringify({formatVersion:1,ledgerId:root.ledgerId,keyId:root.keyId,revision,
    issuedAt:now,expiresAt:now+3600000,records:[]}));
  const payloadDigest=createHash('sha256').update(payload).digest('hex');
  const envelope={payload:payload.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')};
  const journalSignature=sign(null,journalSigningBytes(root,revision,payloadDigest,current.head.payloadDigest),privateKey).toString('base64url');
  appendErasureJournal(database,root,current.head,{envelope,journalSignature},now);
  return prepareErasureArchiveEntries(database,root,now);
}

// Use only the owner-verified custody package, existing scoped storage roles and an empty ledger. Pin
// every existing remote revision before adding missing immutable entries; independently read back the
// complete current head afterwards. No account, provider identity or original can be modified here.
async function bootstrapVerifiedCustody() {
  const directory=resolve(operationsDirectory,'erasure-signing-custody');
  const root=JSON.parse(await readFile(resolve(directory,'public-root.json'),'utf8'));
  const custody=JSON.parse(await readFile(resolve(directory,'verification.json'),'utf8'));
  if(custody.status!=='verified' || custody.ledgerId!==root.ledgerId || custody.keyId!==root.keyId)
    throw new Error('Verified recoverable signing custody required.');
  const sealed=await readFile(resolve(directory,'signing-key.dpapi'),'utf8');
  const raw=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  const protectedKey=JSON.parse(raw);
  if(['ledgerId','keyId','publicKey'].some(key=>protectedKey[key]!==root[key])) throw new Error('Protected signer root differs.');
  const privateKey=createPrivateKey(protectedKey.privateKey);
  const database=new DatabaseSync(resolve(directory,'journal.sqlite'));
  try {
    const prepared=prepareEmptyErasureLedger(database,root,privateKey);
    const [reader,writer]=await Promise.all([authorizeBackupRole('reader'),authorizeBackupRole('writer')]);
    const artifactDirectory=resolve(directory,`bootstrap-${Date.now()}`);await mkdir(artifactDirectory,{recursive:false});let index=0;
    const transport={
      catalog:()=>inventoryBackupVersions((operation,parameters)=>storageRequest(reader,operation,parameters)),
      readPinned:async record=>{const path=resolve(artifactDirectory,`${index++}.remote.json`);await downloadBackupFile(reader,record,path);return readFile(path,'utf8');},
    };
    const before=await transport.catalog();
    const existing=before.versions.filter(record=>record.fileName.startsWith(erasureArchivePrefix(root)));
    if(existing.length) {
      const remote=await auditErasureLedgerArchive(before,root,transport.readPinned);
      const local=prepared.entries.find(entry=>entry.revision===remote.head.revision);
      if(!local || JSON.parse(local.body).payloadDigest!==remote.head.payloadDigest) throw new Error('Remote ledger is ahead or diverged.');
      for(const record of existing) {
        if(!prepared.entries.some(entry=>entry.fileName===record.fileName && entry.sha256===record.sha256))
          throw new Error('Existing archive bytes require review.');
      }
    }
    for(const entry of prepared.entries) {
      if(existing.some(record=>record.fileName===entry.fileName && record.sha256===entry.sha256)) continue;
      const path=resolve(artifactDirectory,`${entry.revision}.upload.json`);await writeFile(path,entry.body,{flag:'wx',mode:0o600});
      const uploaded=await uploadBackupFile(writer,path,entry.fileName);
      await writeFile(resolve(artifactDirectory,`${entry.revision}.upload-result.json`),JSON.stringify(uploaded),{flag:'wx',mode:0o600});
    }
    const verified=await readCurrentErasureArchive(root,transport);
    if(verified.trust.revision!==prepared.head.revision || verified.trust.payloadDigest!==prepared.head.payloadDigest || verified.ledger.records.length)
      throw new Error('Independent bootstrap readback differs.');
    await writeFile(resolve(artifactDirectory,'verification.json'),JSON.stringify({...verified,verifiedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    console.log('Empty independent ledger archive published and current head verified; no real decision signed and no erasure performed.');
  } finally {database.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {await bootstrapVerifiedCustody();}
  catch {console.error('Ledger bootstrap held for custody/archive review; no account erasure performed.');process.exitCode=1;}
}
