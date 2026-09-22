import { createHash,createHmac,randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedMonitorJson } from '../lib/monitor-json.mjs';

const origin='https://relayalbums.com';

// The new capability is separate from D1 read and storage credentials. Missing activation preserves the
// current deployed backup path; a partial/invalid activation fails before export or any backup upload.
export function backupCoordinationTransport(environment=process.env,request=fetch) {
  if(!environment.RELAY_BACKUP_COORDINATION_ENABLED && !environment.RELAY_BACKUP_COORDINATION_SECRET)return null;
  if(environment.RELAY_BACKUP_COORDINATION_ENABLED!=='true' || !/^[a-f0-9]{64}$/.test(environment.RELAY_BACKUP_COORDINATION_SECRET??''))throw new Error('Backup coordination activation is incomplete.');
  return async command=>{
    const timestamp=String(Date.now()),body=JSON.stringify(command);
    const signature=createHmac('sha256',environment.RELAY_BACKUP_COORDINATION_SECRET)
      .update(`relay-backup-coordination-v1.${timestamp}.${body}`).digest('hex');
    let response;
    try{response=await request(`${origin}/api/operations/backup-coordination`,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Relay-Backup-Time':timestamp,'X-Relay-Backup-Signature':signature},body});}
    catch{throw new Error('Backup coordination response is unknown; retain the run for review.');}
    if(!response.ok)throw new Error(`Backup coordination refused (HTTP ${response.status}).`);
    let result;
    try{result=await readBoundedMonitorJson(response);}catch{throw new Error('Backup coordination response is invalid.');}
    if(result.id!==command.id || result.snapshotId!==command.snapshotId || result.state!==(command.action==='begin'?'active':command.outcome) ||
      (command.action==='settle' && result.receiptDigest!==command.receiptDigest))throw new Error('Backup coordination receipt does not match.');
    return result;
  };
}

// Admission precedes every export/upload. The callback must await all storage effects and return a
// receipt digest. Failures stay uncertain even if an independent copy later looks complete. A crash
// leaves active admission, never automatic expiry; replay uses the persisted run ID during review.
export async function runCoordinatedBackup(snapshotId,directory,copy,transport=backupCoordinationTransport()) {
  if(!transport)return copy();
  const command={id:randomUUID(),snapshotId};
  await writeFile(join(directory,'coordination-intent.json'),JSON.stringify(command),{flag:'wx',mode:0o600});
  let admitted=false;
  try {
    await transport({action:'begin',...command});admitted=true;
    const receipt=await copy(Object.freeze({...command}));
    if(!/^[a-f0-9]{64}$/.test(receipt?.sha256??''))throw new Error('Backup evidence digest is missing.');
    await transport({action:'settle',...command,outcome:'settled',receiptDigest:receipt.sha256});
    return receipt;
  } catch(error) {
    // An ambiguous admission is deliberately left active if it reached the server. Do not acknowledge
    // completion from this catch path; uncertain work cannot later be cleared by an ordinary retry.
    const evidence={...command,stage:'uncertain',admissionAcknowledged:admitted};
    const body=JSON.stringify(evidence);
    await writeFile(join(directory,'coordination-uncertain.json'),body,{flag:'wx',mode:0o600});
    if(admitted) {
      try{await transport({action:'settle',...command,outcome:'uncertain',receiptDigest:createHash('sha256').update(body).digest('hex')});}
      catch{/* The existing active/settled record remains authoritative; private evidence requires review. */}
    }
    throw error;
  }
}
