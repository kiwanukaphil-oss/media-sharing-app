import { createHash, createPublicKey, verify } from 'node:crypto';

const domain = 'relay-closure-disposition-v1\n';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');

function decode(value, limit) {
  if (typeof value !== 'string' || value.length > limit * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid disposition encoding.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length > limit || bytes.toString('base64url') !== value) throw new Error('Invalid disposition encoding.');
  return bytes;
}

// Trust is independently pinned operator custody, not a key/digest supplied by the envelope or restored
// snapshot. Expected scope comes from the reviewed current fence/inventory. A signature authenticates
// a statement only: this helper never establishes storage quiescence, erasure success or execution authority.
export function verifyClosureDisposition(envelope, trust, expected, now = Date.now()) {
  if (!exact(envelope, 'payload,signature') || !trust || !identifier(trust.keyId) ||
      !digest(trust.payloadDigest) || !Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(trust.checkedAt) || trust.checkedAt <= 0 || trust.checkedAt > now || now - trust.checkedAt > 300000 ||
      !expected || !identifier(expected.closureId) || !identifier(expected.personId) ||
      !Number.isSafeInteger(expected.generation) || expected.generation <= 0 ||
      !['identityDigest', 'planDigest', 'approvalDigest', 'inventoryDigest'].every(field => digest(expected[field])) ||
      !Array.isArray(expected.effectDigests) || expected.effectDigests.length > 1000 ||
      !expected.effectDigests.every(digest) || new Set(expected.effectDigests).size !== expected.effectDigests.length) {
    throw new Error('Independent current disposition trust and exact scope required.');
  }
  const payload = decode(envelope.payload, 256 * 1024), signature = decode(envelope.signature, 64);
  const key = createPublicKey(trust.publicKey);
  if (signature.length !== 64 || key.asymmetricKeyType !== 'ed25519' ||
      createHash('sha256').update(payload).digest('hex') !== trust.payloadDigest ||
      !verify(null, Buffer.concat([Buffer.from(domain), payload]), key, signature)) throw new Error('Disposition authentication failed.');
  let statement;
  try { statement = JSON.parse(payload.toString('utf8')); } catch { throw new Error('Invalid disposition JSON.'); }
  if (!Buffer.from(JSON.stringify(statement)).equals(payload) || !exact(statement,
    'formatVersion,keyId,closureId,personId,identityDigest,generation,planDigest,approvalDigest,inventoryDigest,observedAt,quiescenceEvidenceDigest,effects') ||
      statement.formatVersion !== 1 || statement.keyId !== trust.keyId ||
      !['closureId','personId','identityDigest','generation','planDigest','approvalDigest','inventoryDigest'].every(field => statement[field] === expected[field]) ||
      !Number.isSafeInteger(statement.observedAt) || statement.observedAt <= 0 || statement.observedAt > trust.checkedAt ||
      !digest(statement.quiescenceEvidenceDigest) || !Array.isArray(statement.effects) ||
      statement.effects.length !== expected.effectDigests.length) throw new Error('Disposition scope or statement requires review.');
  const seen = new Set();
  for (const effect of statement.effects) {
    if (!exact(effect, 'effectDigest,disposition,evidenceDigest') || !digest(effect.effectDigest) || !digest(effect.evidenceDigest) ||
        !['removed', 'retained-shared'].includes(effect.disposition) || seen.has(effect.effectDigest) ||
        !expected.effectDigests.includes(effect.effectDigest)) throw new Error('Disposition coverage requires review.');
    seen.add(effect.effectDigest);
    Object.freeze(effect);
  }
  Object.freeze(statement.effects);
  return Object.freeze({ authenticatedStatement: Object.freeze(statement), executable: false,
    quiescenceProven: false, minimisationAllowed: false, cutoverAllowed: false });
}
