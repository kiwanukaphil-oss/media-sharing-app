import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyErasureLedger, verifiedErasureReceipt } from '../scripts/verify-erasure-ledger.mjs';

const now = 1800000000000;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const record = { personId: 'gone', requestId: 'request', identityDigest: 'a'.repeat(64), state: 'fulfilled',
  updatedAt: now - 1000, evidenceDigest: 'b'.repeat(64) };
const ledger = { formatVersion: 1, ledgerId: 'test-ledger', keyId: 'fixture-key', revision: 2,
  issuedAt: now - 100, expiresAt: now + 60000, records: [record] };

// Every fixture is signed with an ephemeral key; neither production authority nor storage is touched.
function signedFixture(value = ledger, rawText = JSON.stringify(value)) {
  const payload = Buffer.from(rawText);
  return { envelope: { payload: payload.toString('base64url'),
    signature: sign(null, Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'), payload]), privateKey).toString('base64url') },
  trust: { ledgerId: 'test-ledger', keyId: 'fixture-key', revision: 2, headCheckedAt: now,
    payloadDigest: createHash('sha256').update(payload).digest('hex'), publicKey: publicPem } };
}

const good = signedFixture();
assert.equal(verifyErasureLedger(good.envelope, good.trust, now).records[0].state, 'fulfilled');
assert.deepEqual(verifiedErasureReceipt(good.envelope, good.trust, 'gone', now),
  { formatVersion: 1, personId: 'gone', identityDigest: 'a'.repeat(64) });
assert.throws(() => verifiedErasureReceipt(good.envelope, good.trust, 'missing', now), /No current/);
assert.throws(() => verifyErasureLedger(good.envelope, undefined, now), /independent/);
for (const changedTrust of [{ revision: 1 }, { payloadDigest: '0'.repeat(64) }, { keyId: 'other' },
  { ledgerId: 'other' }, { headCheckedAt: now - 300001 }, { headCheckedAt: now + 1 },
  { publicKey: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) }]) {
  assert.throws(() => verifyErasureLedger(good.envelope, { ...good.trust, ...changedTrust }, now));
}
for (const state of ['pending', 'withdrawn', 'review_required']) {
  const fixture = signedFixture({ ...ledger, records: [{ ...record, state, evidenceDigest: null }] });
  assert.equal(verifyErasureLedger(fixture.envelope, fixture.trust, now).records[0].state, state);
  assert.throws(() => verifiedErasureReceipt(fixture.envelope, fixture.trust, 'gone', now), /No current/);
}
for (const changed of [{ formatVersion: 2 }, { extra: true }, { expiresAt: now }, { issuedAt: now + 1 },
  { expiresAt: now + 3600001 }, { records: [record, record] },
  { records: [{ ...record, evidenceDigest: null }] }, { records: [{ ...record, personId: ['gone'] }] },
  { records: [{ ...record, updatedAt: now + 1 }] }, { records: [{ ...record, state: 'deleted' }] },
  { records: [{ ...record, privateEmail: 'unexpected@example.test' }] },
  { records: [record, { ...record, personId: 'second', requestId: 'second' }] }]) {
  const fixture = signedFixture({ ...ledger, ...changed });
  assert.throws(() => verifyErasureLedger(fixture.envelope, fixture.trust, now));
}
const old = signedFixture({ ...ledger, revision: 1 });
assert.throws(() => verifyErasureLedger(old.envelope, good.trust, now), /independent head/);
const fork = signedFixture({ ...ledger, records: [] });
assert.throws(() => verifyErasureLedger(fork.envelope, good.trust, now), /independent head/);
const tamperedSignature = Buffer.from(good.envelope.signature, 'base64url'); tamperedSignature[0] ^= 1;
assert.throws(() => verifyErasureLedger({ ...good.envelope, signature: tamperedSignature.toString('base64url') }, good.trust, now), /signature/);
for (const text of ['{bad', JSON.stringify(ledger).replace('"formatVersion":1', '"formatVersion":2,"formatVersion":1'),
  ` ${JSON.stringify(ledger)}`]) {
  const fixture = signedFixture(ledger, text);
  assert.throws(() => verifyErasureLedger(fixture.envelope, fixture.trust, now));
}
assert.throws(() => verifyErasureLedger({ ...good.envelope, payload: good.envelope.payload + '=' }, good.trust, now), /encoding/);
assert.throws(() => verifyErasureLedger({ ...good.envelope, payload: 'a'.repeat(3 * 1024 * 1024) }, good.trust, now), /encoding/);
const verified = verifyErasureLedger(good.envelope, good.trust, now);
assert.throws(() => { verified.records[0].state = 'withdrawn'; }, TypeError);
console.log('PASS: authenticated ledger, independent current head, rollback/fork/tamper denial, strict records, withdrawal and freshness.');
