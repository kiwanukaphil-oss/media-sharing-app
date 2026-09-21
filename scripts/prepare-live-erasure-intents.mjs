import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { erasureIntentQuery,planErasureIntents } from './record-erasure-intents.mjs';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';
import { operationsDirectory,runPrivateCommand } from './backup-storage.mjs';

// Read the fixed complete projection twice around planning; differing observations require a retry.
// This catches observed changes, but is not a freeze or a guarantee that a later withdrawal cannot occur.
// The caller must obtain these rows from the authenticated live database, never a restored snapshot.
export async function prepareLiveErasureIntents(database,root,readSource,issuer,clock=Date.now) {
  const observedAt=clock(),source=await readSource();
  const plan=planErasureIntents(database,root,source,issuer,observedAt,clock());
  const finalSource=await readSource();
  if(createHash('sha256').update(JSON.stringify(finalSource)).digest('hex')!==plan.sourceDigest)
    throw new Error('Live intent changed during preparation.');
  if(clock()-observedAt>30000) throw new Error('Live intent preparation expired.');
  return {...plan,requestCount:source.requests.length,mode:'observed-intent-review',executable:false,archived:false};
}

// Reuse the protected read-only D1 credential. Private provider bindings are used only in memory;
// the saved review contains opaque IDs/digests and never grants fulfilment or cloud deletion authority.
async function saveLiveIntentPlan() {
  const sealed=await readFile(resolve(operationsDirectory,'hosted-d1.dpapi'),'utf8');
  const raw=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  const source=JSON.parse(await readFile('deploy/cloudflare.json','utf8')),token=JSON.parse(raw).token;
  const settings=JSON.parse(await readFile('deploy/identity-runtime.json','utf8'));
  const root=JSON.parse(await readFile('deploy/erasure-ledger-public-root.json','utf8'));
  const database=new DatabaseSync(resolve(operationsDirectory,'erasure-signing-custody','journal.sqlite'),{readOnly:true});
  try {
    const plan=await prepareLiveErasureIntents(database,root,async()=>{
      const result=await queryReadOnlyDatabase(source,token,erasureIntentQuery);
      if(result.length!==1 || typeof result[0].intents!=='string') throw new Error('Invalid live intent projection.');
      return JSON.parse(result[0].intents);
    },`https://${settings.domain}/`);
    const directory=resolve(operationsDirectory,'erasure-intent-plans');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,`${randomUUID()}.json`),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({status:'private-live-intent-plan-verified',requests:plan.requestCount,
      proposedRevisions:plan.revisions.length,executable:false,archived:false}));
  } finally {database.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {await saveLiveIntentPlan();}
  catch {console.error('Live intent review held; no decision signed or application data changed.');process.exitCode=1;}
}
