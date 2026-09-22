import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { backupBucketId } from './backup-storage.mjs';
const maximumAge = 35 * 86400000;
const context = runId => Buffer.from(`relay-independent-backup-verification-v1:${backupBucketId}:${runId}`);

export function verificationKey(environment=process.env) {
  if (!/^[a-f0-9]{64}$/i.test(environment.BACKUP_VERIFICATION_KEY || '')) throw new Error('Independent verification evidence key is unavailable.');
  return Buffer.from(environment.BACKUP_VERIFICATION_KEY,'hex');
}
export function sealVerificationEvidence(evidence,key,runId) {
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(context(runId));
  const data=Buffer.concat([cipher.update(JSON.stringify(evidence)),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),data]);
}
export function openVerificationEvidence(bytes,key,runId) {
  const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(context(runId));cipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
}

// Bind every carried-forward checksum to an immutable version, destination and original verification date.
export function validateVerificationEvidence(evidence,now=Date.now()) {
  if(evidence?.formatVersion!==1 || evidence.bucketId!==backupBucketId || !Array.isArray(evidence.objects) || evidence.objects.length>100000 ||
    !['full','incremental'].includes(evidence.mode)) throw new Error('Invalid independent verification evidence.');
  for(const date of [evidence.verifiedAt,evidence.fullVerifiedAt]) {
    const age=now-Date.parse(date);if(!Number.isFinite(age)||age<0||age>maximumAge)throw new Error('Independent verification evidence is stale.');
  }
  if(Date.parse(evidence.fullVerifiedAt)>Date.parse(evidence.verifiedAt))throw new Error('Invalid full verification date.');
  const ids=new Set();
  for(const object of evidence.objects) {
    const age=now-Date.parse(object.verifiedAt);
    if(!object.fileId||ids.has(object.fileId)||!Number.isSafeInteger(object.size)||object.size<0||!/^[a-f0-9]{64}$/.test(object.sha256)||
      object.fileName!==`relay/originals/${object.sha256}`||!Number.isFinite(age)||age<0||age>maximumAge||
      Date.parse(object.verifiedAt)>Date.parse(evidence.verifiedAt))throw new Error('Invalid verified object evidence.');
    ids.add(object.fileId);
  }
  return evidence;
}

// Missing history triggers a complete reread; corrupt history stops rather than silently accepting unverifiable bytes.
export async function loadVerificationEvidence(now=Date.now()) {
  if(!process.env.RELAY_PREVIOUS_VERIFICATION_FILE)return null;
  const bytes=await readFile(process.env.RELAY_PREVIOUS_VERIFICATION_FILE);
  const evidence=openVerificationEvidence(bytes,verificationKey(),process.env.RELAY_PREVIOUS_VERIFICATION_RUN);
  try{return validateVerificationEvidence(evidence,now);}catch(error){
    if(error.message==='Independent verification evidence is stale.')return null;
    throw error;
  }
}
export function verificationMode(requested,evidence,now=Date.now()) {
  if(!['full','auto'].includes(requested))throw new Error('Choose full or auto verification.');
  if(requested==='full'||!evidence)return 'full';
  return new Date(now).toISOString().slice(0,7)!==evidence.fullVerifiedAt.slice(0,7)?'full':'incremental';
}
export function matchingVerifiedObject(record,evidence) {
  return evidence?.objects.find(old=>old.fileId===record.fileId&&old.fileName===record.fileName&&old.size===record.size&&old.sha256===record.sha256);
}
export async function saveVerificationEvidence(evidence) {
  if(!process.env.RELAY_VERIFICATION_OUTPUT)return;
  validateVerificationEvidence(evidence);
  await writeFile(process.env.RELAY_VERIFICATION_OUTPUT,sealVerificationEvidence(evidence,verificationKey(),process.env.GITHUB_RUN_ID),{flag:'wx',mode:0o600});
}
