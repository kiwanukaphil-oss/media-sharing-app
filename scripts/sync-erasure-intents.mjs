import { createPrivateKey,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { erasureIntentQuery } from './record-erasure-intents.mjs';
import { publishErasureIntents } from './publish-erasure-intents.mjs';
import { withErasureWriterLock } from './erasure-writer-lock.mjs';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole,downloadBackupFile,operationsDirectory,runPrivateCommand,storageRequest,uploadBackupFile } from './backup-storage.mjs';

const directory=resolve(operationsDirectory,'erasure-signing-custody');
async function readProtectedJson(path) {
  const sealed=await readFile(path,'utf8');
  const raw=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  return JSON.parse(raw);
}

// The owner-verified protected key stays on this operator host. The application and archive reader never
// receive signing credentials. Use existing D1 read-only/B2 reader/upload-only roles; only signed intent
// history is uploaded. All attempts and readbacks remain private, including incomplete attempts for review.
async function syncObservedIntents() {
  const root=JSON.parse(await readFile('deploy/erasure-ledger-public-root.json','utf8'));
  const custody=JSON.parse(await readFile(resolve(directory,'verification.json'),'utf8'));
  const protectedKey=await readProtectedJson(resolve(directory,'signing-key.dpapi'));
  if(custody.status!=='verified' || custody.ledgerId!==root.ledgerId || custody.keyId!==root.keyId ||
      ['ledgerId','keyId','publicKey'].some(key=>protectedKey[key]!==root[key])) throw new Error('Independent custody/root mismatch.');
  const privateKey=createPrivateKey(protectedKey.privateKey);
  const token=(await readProtectedJson(resolve(operationsDirectory,'hosted-d1.dpapi'))).token;
  const source=JSON.parse(await readFile('deploy/cloudflare.json','utf8'));
  const settings=JSON.parse(await readFile('deploy/identity-runtime.json','utf8'));
  const [reader,writer]=await Promise.all([authorizeBackupRole('reader'),authorizeBackupRole('writer')]);
  const artifacts=resolve(directory,`intent-sync-${randomUUID()}`);await mkdir(artifacts,{recursive:false});let download=0;
  const database=new DatabaseSync(resolve(directory,'journal.sqlite'),{open:true});
  try {
    const report=await publishErasureIntents(database,root,privateKey,async()=>{
      const result=await queryReadOnlyDatabase(source,token,erasureIntentQuery);
      if(result.length!==1 || typeof result[0].intents!=='string') throw new Error('Invalid live intent response.');
      return JSON.parse(result[0].intents);
    },`https://${settings.domain}/`,{
      catalog:()=>inventoryBackupVersions((operation,parameters)=>storageRequest(reader,operation,parameters)),
      readPinned:async record=>{
        const path=resolve(artifacts,`${download++}.read.json`);await downloadBackupFile(reader,record,path);return readFile(path,'utf8');
      },
      upload:async entry=>{
        const path=resolve(artifacts,`${entry.revision}.upload.json`);await writeFile(path,entry.body,{flag:'wx',mode:0o600});
        const result=await uploadBackupFile(writer,path,entry.fileName);
        await writeFile(resolve(artifacts,`${entry.revision}.version.json`),JSON.stringify(result),{flag:'wx',mode:0o600});
      },
    });
    await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({...report,verifiedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({status:'observed-intent-archive-verified',requests:report.requestCount,
      revision:report.trust.revision,currentnessVerified:report.currentnessVerified,writeFreezeVerified:false,realErasurePerformed:false,cutoverAllowed:false}));
  } finally {database.close();}
}

try {await withErasureWriterLock(directory,syncObservedIntents);}
catch {console.error('Intent synchronization held for review; any signed/uploaded prefix retained, no erasure performed.');process.exitCode=1;}
