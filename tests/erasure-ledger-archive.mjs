import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync,sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,appendErasureJournal,journalSigningBytes } from '../scripts/erasure-ledger-journal.mjs';
import { prepareErasureArchiveEntries,auditErasureLedgerArchive } from '../scripts/audit-erasure-ledger-archive.mjs';
import { readCurrentErasureArchive } from '../scripts/read-erasure-ledger-archive.mjs';
import { restoreErasureJournal } from '../scripts/restore-erasure-journal.mjs';

const now=1800000000000,{publicKey,privateKey}=generateKeyPairSync('ed25519');
const root={ledgerId:'fixture',keyId:'fixture',publicKey:publicKey.export({type:'spki',format:'pem'})};
const pending={personId:'person',requestId:'request',identityDigest:'a'.repeat(64),state:'pending',updatedAt:now-1,evidenceDigest:null};
const database=new DatabaseSync(':memory:');
let entries;
try {
  initialiseErasureJournal(database,root);let head={revision:0,payloadDigest:null};
  for(const [index,state] of ['pending','withdrawn'].entries()) {
    const ledger={formatVersion:1,ledgerId:root.ledgerId,keyId:root.keyId,revision:head.revision+1,issuedAt:now+index,expiresAt:now+1000,
      records:[{...pending,state,updatedAt:now-1+index}]};
    const payload=Buffer.from(JSON.stringify(ledger)),payloadDigest=createHash('sha256').update(payload).digest('hex');
    const envelope={payload:payload.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')};
    const journalSignature=sign(null,journalSigningBytes(root,ledger.revision,payloadDigest,head.payloadDigest),privateKey).toString('base64url');
    head=appendErasureJournal(database,root,head,{envelope,journalSignature},now+index).head;
  }
  entries=prepareErasureArchiveEntries(database,root,now+1).entries;
} finally {database.close();}
const versions=entries.map((entry,index)=>({fileId:String(index),action:'upload',fileName:entry.fileName,size:entry.size,sha256:entry.sha256}));
const bodies=new Map(entries.map((entry,index)=>[String(index),entry.body]));
const inspect=(records=versions,reader=record=>bodies.get(record.fileId))=>auditErasureLedgerArchive({listingComplete:true,versions:records},root,reader,now+2000);
const normal=await inspect();
assert.equal(normal.head.revision,2);assert.equal(normal.ledger.records[0].state,'withdrawn');
assert.equal(normal.currentnessVerified,false);assert.equal(normal.cutoverAllowed,false);
assert.equal((await inspect([...versions].reverse())).head.revision,2,'Catalog order cannot select an older decision');
const replay={...versions[0],fileId:'replayed'};bodies.set(replay.fileId,entries[0].body);
assert.equal((await inspect([...versions,replay])).head.revision,2,'A later upload of an old signed revision cannot roll back the head');
await assert.rejects(inspect([versions[1]]),/missing|forked/);
await assert.rejects(inspect([...versions,{...versions[1],fileId:'hidden',action:'hide'}]),/version/);
await assert.rejects(inspect([...versions,versions[0]]),/version/);
await assert.rejects(inspect(versions,()=>entries[0].body+'tamper'),/bytes/);
for(const change of [{size:0},{size:Infinity},{sha256:'wrong'},{fileName:'relay/erasure-ledger/journal/fixture/unreviewed.json'}])
  await assert.rejects(inspect([{...versions[0],...change},versions[1]]));
const fork=JSON.parse(entries[1].body);fork.journalSignature=JSON.parse(entries[0].body).journalSignature;
const forkText=JSON.stringify(fork),forkVersion={...versions[1],fileId:'fork',size:Buffer.byteLength(forkText),sha256:createHash('sha256').update(forkText).digest('hex')};
bodies.set('fork',forkText);
await assert.rejects(inspect([...versions,forkVersion]),/Competing/);
await assert.rejects(inspect([versions[0],forkVersion]),/signature/);
// Even two genuinely signed alternatives must not be resolved by upload time or catalog ordering.
const competing=JSON.parse(entries[1].body),competingLedger=JSON.parse(Buffer.from(competing.envelope.payload,'base64url').toString('utf8'));
competingLedger.records[0].state='review_required';
const competingPayload=Buffer.from(JSON.stringify(competingLedger));
competing.payloadDigest=createHash('sha256').update(competingPayload).digest('hex');
competing.envelope={payload:competingPayload.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),competingPayload]),privateKey).toString('base64url')};
competing.journalSignature=sign(null,journalSigningBytes(root,2,competing.payloadDigest,competing.previousDigest),privateKey).toString('base64url');
const competingText=JSON.stringify(competing),competingVersion={...versions[1],fileId:'valid-fork',
  fileName:versions[1].fileName.replace(/-[a-f0-9]{64}\.json$/,'-'+competing.payloadDigest+'.json'),
  size:Buffer.byteLength(competingText),sha256:createHash('sha256').update(competingText).digest('hex')};
bodies.set('valid-fork',competingText);
assert.equal((await inspect([versions[0],competingVersion])).ledger.records[0].state,'review_required');
await assert.rejects(inspect([...versions,competingVersion]),/Competing/);
const otherRoot={...root,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})};
await assert.rejects(auditErasureLedgerArchive({listingComplete:true,versions},otherRoot,record=>bodies.get(record.fileId),now+2000),/signature/);
await assert.rejects(auditErasureLedgerArchive({listingComplete:false,versions},root,()=>{},now),/Complete/);
assert.equal((await inspect([...versions,{fileName:'relay/unrelated'}])).distinctRevisions,2);
const stableTransport={catalog:async()=>({listingComplete:true,versions}),readPinned:async record=>bodies.get(record.fileId)};
const current=await readCurrentErasureArchive(root,stableTransport,()=>now+2);
assert.equal(current.currentnessVerified,true);assert.equal(current.trust.revision,2);assert.equal(current.cutoverAllowed,false);
await assert.rejects(readCurrentErasureArchive(root,stableTransport,()=>now+2000),/freshness/);
let reads=0;
await assert.rejects(readCurrentErasureArchive(root,{...stableTransport,
  catalog:async()=>({listingComplete:true,versions:++reads===1?versions:[...versions,replay]})},()=>now+2),/changed/);
reads=0;
assert.equal((await readCurrentErasureArchive(root,{...stableTransport,
  catalog:async()=>({listingComplete:true,versions:++reads===1?versions:[...versions,{fileName:'relay/unrelated'}]})},()=>now+2)).currentnessVerified,true);
console.log('PASS: complete signed archive chain, pinned bytes, retained withdrawals, replay/order safety, duplicate revisions, missing history, forks, wrong roots and no implied currentness.');

// Simulate loss of both the application DB and original journal: only public trust and cloud bytes remain.
const recovered=new DatabaseSync(':memory:');
try {
  const report=await restoreErasureJournal(recovered,root,{listingComplete:true,versions:[...versions,replay]},record=>bodies.get(record.fileId),now+2000);
  assert.equal(report.revisions,2);assert.equal(report.records,1);
  assert.equal(report.currentnessVerified,false);assert.equal(report.writerActivated,false);assert.equal(report.cutoverAllowed,false);
  assert.equal(recovered.prepare('SELECT COUNT(*) AS n FROM ledger_revisions').get().n,2);
  const latest=recovered.prepare('SELECT envelope FROM ledger_revisions WHERE revision=2').get();
  assert.equal(JSON.parse(Buffer.from(JSON.parse(latest.envelope).payload,'base64url')).records[0].state,'withdrawn');
  await assert.rejects(restoreErasureJournal(recovered,root,{listingComplete:true,versions},()=>{},now+2000),/new empty/);
} finally {recovered.close();}
for(const brokenVersions of [[versions[1]],[...versions,competingVersion]]) {
  const target=new DatabaseSync(':memory:');
  try {
    await assert.rejects(restoreErasureJournal(target,root,{listingComplete:true,versions:brokenVersions},record=>bodies.get(record.fileId),now+2000));
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM sqlite_schema').get().n,0,'Failed audit leaves destination empty');
  } finally {target.close();}
}
const changedTarget=new DatabaseSync(':memory:');
try {
  await assert.rejects(restoreErasureJournal(changedTarget,root,{listingComplete:true,versions},record=>{
    changedTarget.exec('CREATE TABLE IF NOT EXISTS preserve_me (value TEXT)');return bodies.get(record.fileId);
  },now+2000),/destination changed/);
  assert.equal(changedTarget.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='ledger_root'").get().n,0);
} finally {changedTarget.close();}
console.log('PASS: independent history reconstruction, retained withdrawal after expiry, no overwrite, no signer or activation, and failed-audit isolation.');
