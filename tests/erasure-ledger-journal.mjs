import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,readErasureJournal,appendErasureJournal,journalSigningBytes } from '../scripts/erasure-ledger-journal.mjs';
import { verifyArchivedErasureLedger,verifyErasureLedger } from '../scripts/verify-erasure-ledger.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const root={ledgerId:'fixture',keyId:'fixture-key',publicKey:publicKey.export({type:'spki',format:'pem'})};
const now=1800000000000;
const pending={personId:'person',requestId:'request',identityDigest:'a'.repeat(64),state:'pending',updatedAt:now-10,evidenceDigest:null};
const emptyHead={revision:0,payloadDigest:null};
// Disposable keys sign fixture proposals only; no production identity, signing key or fulfilled decision is created.
function proposal(head,records,issuedAt=now) {
  const ledger={formatVersion:1,ledgerId:root.ledgerId,keyId:root.keyId,revision:head.revision+1,issuedAt,expiresAt:issuedAt+1000,records};
  const payload=Buffer.from(JSON.stringify(ledger)),payloadDigest=createHash('sha256').update(payload).digest('hex');
  return {envelope:{payload:payload.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')},
    journalSignature:sign(null,journalSigningBytes(root,ledger.revision,payloadDigest,head.payloadDigest),privateKey).toString('base64url')};
}
await mkdir('.sites-runtime/ledger-journal-tests',{recursive:true});
// Retained synthetic databases are cleanup candidates; they contain no production data or private signing key.
const path=`.sites-runtime/ledger-journal-tests/${randomUUID()}.sqlite`;
const first=new DatabaseSync(path),second=new DatabaseSync(path);
try {
  initialiseErasureJournal(first,root); initialiseErasureJournal(second,root);
  assert.deepEqual(readErasureJournal(first,root,now).head,emptyHead);
  assert.throws(()=>initialiseErasureJournal(first,{...root,keyId:'replacement'}),/root/);
  assert.throws(()=>initialiseErasureJournal(first,{...root,publicKey:privateKey.export({type:'pkcs8',format:'pem'})}),/root/);
  const firstEntry=proposal(emptyHead,[pending]);
  let head=appendErasureJournal(first,root,emptyHead,firstEntry,now).head;
  assert.equal(head.revision,1);
  const read=readErasureJournal(second,root,now+2000);
  assert.equal(read.cutoverAllowed,false); assert.equal(read.ledger.records[0].state,'pending');
  const trust={...root,...head,headCheckedAt:now+2000};
  assert.equal(verifyArchivedErasureLedger(firstEntry.envelope,trust,now+2000).current,false);
  assert.throws(()=>verifyErasureLedger(firstEntry.envelope,trust,now+2000),/freshness/);
  const review={...pending,state:'review_required',updatedAt:now+1};
  const next=proposal(head,[review],now+2),staleHead=head;
  first.exec('BEGIN IMMEDIATE');
  assert.throws(()=>appendErasureJournal(second,root,head,next,now+2),/locked/);
  first.exec('ROLLBACK');
  // A crash at head advancement must roll back the already inserted history row too.
  first.exec("CREATE TRIGGER fail_head BEFORE UPDATE ON ledger_head BEGIN SELECT RAISE(ABORT,'simulated interruption'); END;");
  assert.throws(()=>appendErasureJournal(first,root,head,next,now+2),/simulated interruption/);
  assert.equal(first.prepare('SELECT COUNT(*) AS n FROM ledger_revisions').get().n,1);
  assert.deepEqual(readErasureJournal(first,root,now+2).head,head);
  first.exec('DROP TRIGGER fail_head');
  head=appendErasureJournal(first,root,head,next,now+2).head;
  assert.throws(()=>appendErasureJournal(second,root,staleHead,next,now+2),/head changed/);
  for(const records of [[],[{...review,identityDigest:'b'.repeat(64)}],[{...review,updatedAt:now}],[{...review,requestId:'replacement',updatedAt:now+3}]])
    assert.throws(()=>appendErasureJournal(first,root,head,proposal(head,records,now+4),now+4));
  const withdrawn={...review,state:'withdrawn',updatedAt:now+3};
  head=appendErasureJournal(first,root,head,proposal(head,[withdrawn],now+4),now+4).head;
  assert.throws(()=>appendErasureJournal(first,root,head,proposal(head,[{...pending,updatedAt:now+5}],now+6),now+6),/distinct/);
  const newRequest={...pending,requestId:'new-request',updatedAt:now+5};
  head=appendErasureJournal(first,root,head,proposal(head,[newRequest],now+6),now+6).head;
  const fulfilled={...newRequest,state:'fulfilled',updatedAt:now+9,evidenceDigest:'c'.repeat(64)};
  assert.throws(()=>appendErasureJournal(first,root,head,proposal(head,[fulfilled],now+10),now+10),/transition/);
  const nextReview={...newRequest,state:'review_required',updatedAt:now+7};
  head=appendErasureJournal(first,root,head,proposal(head,[nextReview],now+8),now+8).head;
  head=appendErasureJournal(first,root,head,proposal(head,[fulfilled],now+10),now+10).head;
  assert.throws(()=>appendErasureJournal(first,root,head,proposal(head,[{...fulfilled,state:'withdrawn',evidenceDigest:null,updatedAt:now+11}],now+12),now+12),/backwards/);
  const refreshed=proposal(head,[fulfilled],now+5000);
  head=appendErasureJournal(first,root,head,refreshed,now+5000).head;
  assert.equal(readErasureJournal(second,root,now+5000).ledger.records[0].state,'fulfilled');
  assert.throws(()=>appendErasureJournal(first,root,head,{...proposal(head,[fulfilled],now+5001),journalSignature:firstEntry.journalSignature},now+5001),/signature/);
  first.prepare('UPDATE ledger_head SET revision=revision-1 WHERE id=1').run();
  assert.throws(()=>readErasureJournal(first,root,now+5001),/head/);
  first.prepare('UPDATE ledger_head SET revision=? WHERE id=1').run(head.revision);
  first.prepare("UPDATE ledger_revisions SET journal_signature=? WHERE revision=2").run(firstEntry.journalSignature);
  assert.throws(()=>readErasureJournal(first,root,now+5001),/signature/);
  console.log('PASS: durable ledger locking/CAS, interrupted-write rollback, signed predecessor links, withdrawal/new-request history, terminal fulfilment, retained refresh and expired audit/current denial.');
} finally {first.close();second.close();}
