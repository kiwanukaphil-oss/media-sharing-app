import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync,sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { prepareEmptyErasureLedger } from '../scripts/bootstrap-erasure-ledger.mjs';
import { appendErasureJournal,journalSigningBytes } from '../scripts/erasure-ledger-journal.mjs';

const now=1800000000000,{publicKey,privateKey}=generateKeyPairSync('ed25519');
const root={ledgerId:'bootstrap-fixture',keyId:'fixture',publicKey:publicKey.export({type:'spki',format:'pem'})};
const database=new DatabaseSync(':memory:');
try {
  const initial=prepareEmptyErasureLedger(database,root,privateKey,now);
  assert.equal(initial.head.revision,1);assert.equal(initial.entries.length,1);assert.equal(initial.cutoverAllowed,false);
  assert.deepEqual(JSON.parse(Buffer.from(JSON.parse(initial.entries[0].body).envelope.payload,'base64url')).records,[]);
  assert.deepEqual(prepareEmptyErasureLedger(database,root,privateKey,now+1).head,initial.head,'Fresh bootstrap is idempotent');
  const renewed=prepareEmptyErasureLedger(database,root,privateKey,now+3600000);
  assert.equal(renewed.head.revision,2);assert.equal(renewed.entries.length,2);
  assert.throws(()=>prepareEmptyErasureLedger(database,root,generateKeyPairSync('ed25519').privateKey,now+3600001),/key differs/);
  // Even a pending real-shaped record blocks this intentionally empty-only entry point.
  const ledger={formatVersion:1,ledgerId:root.ledgerId,keyId:root.keyId,revision:3,issuedAt:now+3600001,expiresAt:now+3601000,
    records:[{personId:'fixture-person',requestId:'fixture-request',identityDigest:'a'.repeat(64),state:'pending',updatedAt:now,evidenceDigest:null}]};
  const payload=Buffer.from(JSON.stringify(ledger)),payloadDigest=createHash('sha256').update(payload).digest('hex');
  appendErasureJournal(database,root,renewed.head,{envelope:{payload:payload.toString('base64url'),signature:sign(null,
    Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')},
    journalSignature:sign(null,journalSigningBytes(root,3,payloadDigest,renewed.head.payloadDigest),privateKey).toString('base64url')},now+3600001);
  assert.throws(()=>prepareEmptyErasureLedger(database,root,privateKey,now+3600002),/populated/);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM ledger_revisions').get().n,3);
  console.log('PASS: empty-only ledger bootstrap, idempotent fresh setup, retained expiry renewal, independent key binding and populated-ledger refusal.');
} finally {database.close();}
