import { createHash, createPublicKey, verify } from 'node:crypto';

const domain = 'relay-erasure-ledger-v1\n';
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const isIdentifier = value => typeof value === 'string' && identifierPattern.test(value);
const isDigest = value => typeof value === 'string' && digestPattern.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function decodeCanonicalBase64(value, maximumBytes) {
  if (typeof value !== 'string' || value.length > maximumBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid ledger encoding.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length > maximumBytes || bytes.toString('base64url') !== value) throw new Error('Invalid ledger encoding.');
  return bytes;
}

// The trusted key and current head MUST arrive independently of the snapshot and supplied envelope.
// A valid signature proves authorship, not completeness/currentness or successful cloud erasure.
// Pinning the exact current payload prevents a previously signed revision or fork being replayed.
export function verifyErasureLedger(envelope, trust, now = Date.now()) {
  if (!trust || !positiveInteger(trust.headCheckedAt) || trust.headCheckedAt > now || now - trust.headCheckedAt > 300000)
    throw new Error('Current independent ledger trust is required.');
  return verifySignedLedger(envelope,trust,now,true);
}

// Audit old signed revisions without pretending that their evidence is current. This distinct wrapper
// cannot produce an erasure receipt; normal restore verification still requires a fresh independent head
// and an unexpired manifest. Signing custody and the archived digest must be independently trusted.
export function verifyArchivedErasureLedger(envelope, trust, now = Date.now()) {
  return Object.freeze({ledger:verifySignedLedger(envelope,trust,now,false),current:false,cutoverAllowed:false});
}

// Share signature/schema validation between historical audit and the stricter current restore boundary.
// Only the latter accepts unexpired evidence as current; both reject future issuance and bad lifetimes.
function verifySignedLedger(envelope, trust, now, requireCurrent) {
  if (!exactKeys(envelope, ['payload', 'signature']) || !trust || !positiveInteger(now) ||
      !isIdentifier(trust.ledgerId) || !isIdentifier(trust.keyId) ||
      !positiveInteger(trust.revision) || !isDigest(trust.payloadDigest))
    throw new Error('Current independent ledger trust is required.');
  const payload = decodeCanonicalBase64(envelope.payload, 1024 * 1024);
  const signature = decodeCanonicalBase64(envelope.signature, 64);
  if (signature.length !== 64 || createHash('sha256').update(payload).digest('hex') !== trust.payloadDigest)
    throw new Error('Ledger does not match the current independent head.');
  const publicKey = createPublicKey(trust.publicKey);
  if (publicKey.asymmetricKeyType !== 'ed25519' ||
      !verify(null, Buffer.concat([Buffer.from(domain), payload]), publicKey, signature))
    throw new Error('Ledger signature is invalid.');
  const text = payload.toString('utf8');
  let ledger;
  try { ledger = JSON.parse(text); } catch { throw new Error('Ledger JSON is invalid.'); }
  // Re-serialization also rejects duplicate JSON keys and invalid UTF-8, avoiding parser ambiguity.
  if (!Buffer.from(text).equals(payload) || JSON.stringify(ledger) !== text || !exactKeys(ledger,
    ['formatVersion', 'ledgerId', 'keyId', 'revision', 'issuedAt', 'expiresAt', 'records']) ||
      ledger.formatVersion !== 1 || ledger.ledgerId !== trust.ledgerId || ledger.keyId !== trust.keyId ||
      ledger.revision !== trust.revision || !positiveInteger(ledger.issuedAt) || !positiveInteger(ledger.expiresAt) ||
      ledger.issuedAt > now || ledger.expiresAt <= ledger.issuedAt || (requireCurrent && ledger.expiresAt <= now) || ledger.expiresAt - ledger.issuedAt > 3600000 ||
      !Array.isArray(ledger.records) || ledger.records.length > 1000)
    throw new Error('Ledger schema or freshness is invalid.');
  const people = new Set(), requests = new Set(), identities = new Set();
  for (const record of ledger.records) {
    if (!exactKeys(record, ['personId', 'requestId', 'identityDigest', 'state', 'updatedAt', 'evidenceDigest']) ||
        !isIdentifier(record.personId) || !isIdentifier(record.requestId) ||
        !isDigest(record.identityDigest) || !positiveInteger(record.updatedAt) || record.updatedAt > ledger.issuedAt ||
        !['pending', 'withdrawn', 'review_required', 'fulfilled'].includes(record.state) ||
        (record.state === 'fulfilled' ? !isDigest(record.evidenceDigest) : record.evidenceDigest !== null) ||
        people.has(record.personId) || requests.has(record.requestId) || identities.has(record.identityDigest))
      throw new Error('Ledger decision records require review.');
    people.add(record.personId); requests.add(record.requestId); identities.add(record.identityDigest);
    Object.freeze(record);
  }
  Object.freeze(ledger.records);
  return Object.freeze(ledger);
}

// Only a current fulfilled decision may drive the isolated transformation. Pending/withdrawn/unknown
// decisions never become erasure authority. Cloud execution and production cutover remain separate gates.
export function verifiedErasureReceipt(envelope, trust, personId, now = Date.now()) {
  const ledger = verifyErasureLedger(envelope, trust, now);
  const record = ledger.records.find(entry => entry.personId === personId);
  if (!record || record.state !== 'fulfilled') throw new Error('No current fulfilled erasure decision.');
  return Object.freeze({ formatVersion: 1, personId: record.personId, identityDigest: record.identityDigest });
}

// Historical device associations are separate evidence, authenticated by the fulfilled record's digest.
// This verifies the operator's statement, not the underlying claim ceremony or cloud erasure outcomes.
export function verifiedLegacyErasureBindings(envelope, trust, personId, evidenceText, now = Date.now()) {
  const ledger = verifyErasureLedger(envelope,trust,now);
  const record = ledger.records.find(entry => entry.personId === personId);
  if (!record || record.state !== 'fulfilled' || typeof evidenceText !== 'string' || Buffer.byteLength(evidenceText) > 128 * 1024 ||
      createHash('sha256').update(evidenceText).digest('hex') !== record.evidenceDigest) throw new Error('Authenticated historical binding evidence is required.');
  let evidence;
  try { evidence = JSON.parse(evidenceText); } catch { throw new Error('Historical binding evidence JSON is invalid.'); }
  if (JSON.stringify(evidence) !== evidenceText || !exactKeys(evidence,['formatVersion','personId','identityDigest','sourceSnapshotDigest','legacyDevices']) ||
      evidence.formatVersion !== 1 || evidence.personId !== personId || evidence.identityDigest !== record.identityDigest ||
      !isDigest(evidence.sourceSnapshotDigest) || !Array.isArray(evidence.legacyDevices) || evidence.legacyDevices.length > 1000)
    throw new Error('Historical binding evidence requires review.');
  const ids = new Set();
  for (const binding of evidence.legacyDevices) {
    if (!exactKeys(binding,['deviceId','spaceId']) || !isIdentifier(binding.deviceId) || !isIdentifier(binding.spaceId) || ids.has(binding.deviceId))
      throw new Error('Historical device bindings are ambiguous.');
    ids.add(binding.deviceId); Object.freeze(binding);
  }
  Object.freeze(evidence.legacyDevices);
  return Object.freeze(evidence);
}
