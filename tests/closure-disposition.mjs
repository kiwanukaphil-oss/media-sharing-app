import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyClosureDisposition } from '../scripts/verify-closure-disposition.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const now = 1000000;
const expected = { closureId:'closure',personId:'person',identityDigest:'1'.repeat(64),generation:1,
  planDigest:'2'.repeat(64),approvalDigest:'3'.repeat(64),inventoryDigest:'4'.repeat(64),effectDigests:['5'.repeat(64),'6'.repeat(64)] };
const statement = { formatVersion:1,keyId:'fixture',...expected,observedAt:now-100,
  quiescenceEvidenceDigest:'7'.repeat(64),effects:expected.effectDigests.map((effectDigest,index)=>({effectDigest,
    disposition:index?'retained-shared':'removed',evidenceDigest:'8'.repeat(64)})) };
delete statement.effectDigests;
const encode = (value, prefix='relay-closure-disposition-v1\n') => {
  const payload=Buffer.from(JSON.stringify(value));
  return {envelope:{payload:payload.toString('base64url'),signature:sign(null,Buffer.concat([Buffer.from(prefix),payload]),privateKey).toString('base64url')},
    trust:{keyId:'fixture',publicKey:publicKey.export({type:'spki',format:'pem'}),checkedAt:now,payloadDigest:createHash('sha256').update(payload).digest('hex')}};
};
const valid=encode(statement);
const result=verifyClosureDisposition(valid.envelope,valid.trust,expected,now);
assert.equal(result.executable,false);
assert.equal(result.quiescenceProven,false);
assert.equal(result.minimisationAllowed,false);
assert.ok(Object.isFrozen(result.authenticatedStatement.effects[0]));
for(const changed of [
  {...statement,generation:2}, {...statement,inventoryDigest:'9'.repeat(64)},
  {...statement,effects:statement.effects.slice(1)},
  {...statement,effects:[statement.effects[0],statement.effects[0]]},
  {...statement,effects:statement.effects.map(effect=>({...effect,disposition:'expired'}))},
  {...statement,observedAt:now+1}, {...statement,extra:'unreviewed'},
]) {
  const signed=encode(changed);
  assert.throws(()=>verifyClosureDisposition(signed.envelope,signed.trust,expected,now));
}
assert.throws(()=>verifyClosureDisposition(valid.envelope,{...valid.trust,checkedAt:now-300001},expected,now));
assert.throws(()=>verifyClosureDisposition(valid.envelope,{...valid.trust,payloadDigest:'0'.repeat(64)},expected,now));
const wrongDomain=encode(statement,'relay-erasure-ledger-v1\n');
assert.throws(()=>verifyClosureDisposition(wrongDomain.envelope,wrongDomain.trust,expected,now));
assert.throws(()=>verifyClosureDisposition({...valid.envelope,signature:valid.envelope.signature+'='},valid.trust,expected,now));
console.log('PASS: independently pinned disposition signatures, exact scope/coverage, stale trust, domain separation and no inferred execution/minimisation authority.');
