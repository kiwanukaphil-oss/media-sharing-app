import assert from 'node:assert/strict';
import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,readErasureJournal } from '../scripts/erasure-ledger-journal.mjs';
import { publishErasureIntents } from '../scripts/publish-erasure-intents.mjs';
import { withErasureWriterLock } from '../scripts/erasure-writer-lock.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const root={ledgerId:'publishing-fixture',keyId:'fixture',publicKey:publicKey.export({type:'spki',format:'pem'})};
const now=1800000000000,issuer='https://identity.example/';
const pending={requestId:'request',personId:'person',issuer,subject:'synthetic',requestedAt:now-100,updatedAt:now-100,state:'pending'};
const withdrawn={...pending,state:'withdrawn',updatedAt:now-50};
const observation=row=>({totalRequests:1,requests:[row]});
const versions=[],bodies=new Map();let uploads=0,failUpload=false;
const transport={
  catalog:async()=>({listingComplete:true,versions:[...versions]}),
  readPinned:async row=>bodies.get(row.fileId),
  upload:async entry=>{
    if(failUpload)throw new Error('simulated cloud interruption');
    const fileId=String(++uploads);bodies.set(fileId,entry.body);
    versions.push({fileId,fileName:entry.fileName,action:'upload',size:entry.size,sha256:entry.sha256});
  },
};
const database=new DatabaseSync(':memory:');
try {
  initialiseErasureJournal(database,root);
  let reads=0;
  await assert.rejects(publishErasureIntents(database,root,privateKey,async()=>observation(++reads<3?pending:withdrawn),issuer,transport,()=>now),/changed|expired/);
  assert.equal(uploads,1,'The historical pending observation remains retained but not reported synchronized');
  const recovered=await publishErasureIntents(database,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now);
  assert.equal(recovered.trust.revision,2);assert.equal(recovered.ledger.records[0].state,'withdrawn');
  assert.equal(recovered.intentObservedConsistent,true);assert.equal(recovered.writeFreezeVerified,false);assert.equal(recovered.cutoverAllowed,false);
  await publishErasureIntents(database,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now);
  assert.equal(uploads,2,'Verified immutable versions are not uploaded twice');
  failUpload=true;
  await assert.rejects(publishErasureIntents(database,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now+3600000),/interruption/);
  assert.equal(readErasureJournal(database,root,now+3600000).head.revision,3);
  failUpload=false;
  const retry=await publishErasureIntents(database,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now+3600000);
  assert.equal(retry.trust.revision,3);assert.equal(uploads,3);
  const missingLocal=new DatabaseSync(':memory:');
  try {
    initialiseErasureJournal(missingLocal,root);
    await assert.rejects(publishErasureIntents(missingLocal,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now+3600000),/ahead|diverged/);
    assert.equal(readErasureJournal(missingLocal,root,now+3600000).head.revision,0);
  } finally {missingLocal.close();}
  versions.push({...versions[0],fileId:'hidden',action:'hide'});
  await assert.rejects(publishErasureIntents(database,root,privateKey,async()=>observation(withdrawn),issuer,transport,()=>now+3600000),/version/);
} finally {database.close();}

// Crash-like stale locks require inspection; no age-based stealing or concurrent signer is allowed.
const directory=`.sites-runtime/erasure-lock-tests/${randomUUID()}`;
await mkdir(directory,{recursive:true});let release,entered;
const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
const first=withErasureWriterLock(directory,async()=>{entered();await held;return 'complete';});
await started;
await assert.rejects(withErasureWriterLock(directory,async()=>assert.fail('Concurrent action must not run')),/locked/);
release();assert.equal(await first,'complete');
await assert.rejects(readFile(`${directory}/writer.lock`),/ENOENT/);
await assert.rejects(withErasureWriterLock(directory,async()=>{throw new Error('operation failure');}),/operation failure/);
assert.equal(await withErasureWriterLock(directory,async()=>true),true);
// Retained fixture is a cleanup candidate; it contains no key or production identity.
await writeFile(`${directory}/writer.lock`,'stale fixture');
await assert.rejects(withErasureWriterLock(directory,async()=>assert.fail('Stale lock must not be stolen')),/locked/);
assert.equal(await readFile(`${directory}/writer.lock`,'utf8'),'stale fixture');
console.log('PASS: signed immutable publication, independent head readback, changed intent, interrupted upload retry, remote lead rejection, retained history and exclusive non-stealing writer lock.');
