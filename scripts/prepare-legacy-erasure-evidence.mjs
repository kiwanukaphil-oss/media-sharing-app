import { createHash } from 'node:crypto';
import { importSnapshot, checkDatabase } from './relay-backup.mjs';
import { inspectHistoricalSnapshot } from './inventory-historical-snapshots.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

// Derive associations from recorded claim/session/membership relationships in a separately pinned
// source snapshot. Names, email addresses and current roles never establish historical ownership.
// This unsigned review artifact cannot fulfil a request or authorise erasure; independent custody,
// current intent, claim completeness and execution evidence still need the production ledger workflow.
export function prepareLegacyErasureEvidence(sql, sourceSnapshotDigest, personId, identityDigest) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > 16 * 1024 * 1024 ||
      typeof sourceSnapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSnapshotDigest) ||
      digest(sql) !== sourceSnapshotDigest || !identifier(personId) ||
      typeof identityDigest !== 'string' || !/^[a-f0-9]{64}$/.test(identityDigest))
    throw new Error('Pinned source snapshot and identity are required.');
  const inventory = inspectHistoricalSnapshot(sql);
  const person = inventory.people.find(entry => entry.personId === personId);
  if (!inventory.minimisationSchemaReviewed || !person || person.tombstone || person.identityDigest !== identityDigest)
    throw new Error('Source identity or claim schema requires review.');
  const database = importSnapshot(sql);
  try {
    checkDatabase(database);
    // Include either side of the association so an inconsistent session cannot silently hide a claim.
    const claims = database.prepare(`SELECT c.device_id, c.claimed_at, d.space_id AS device_space,
      d.created_at AS device_created, m.space_id AS member_space, m.person_id AS member_person,
      m.created_at AS member_created, a.person_id AS session_person, a.created_at AS session_created
      FROM legacy_owner_claims c JOIN devices d ON d.id=c.device_id
      JOIN space_memberships m ON m.id=c.membership_id JOIN account_sessions a ON a.id=c.session_id
      WHERE m.person_id=? OR a.person_id=? ORDER BY c.device_id`).all(personId,personId);
    if (claims.length > 1000) throw new Error('Historical claim count requires review.');
    const legacyDevices = claims.map(claim => {
      if (claim.member_person !== personId || claim.session_person !== personId ||
          claim.device_space !== claim.member_space || !identifier(claim.device_id) || !identifier(claim.device_space) ||
          !Number.isSafeInteger(claim.claimed_at) || claim.claimed_at <= 0 ||
          [claim.device_created,claim.member_created,claim.session_created].some(time =>
            !Number.isSafeInteger(time) || time <= 0 || time > claim.claimed_at) ||
          database.prepare('SELECT 1 FROM personal_spaces WHERE space_id=?').get(claim.device_space))
        throw new Error('Historical claim relationships require review.');
      return {deviceId:claim.device_id,spaceId:claim.device_space};
    });
    const evidence = {formatVersion:1,personId,identityDigest,sourceSnapshotDigest,legacyDevices};
    const evidenceText = JSON.stringify(evidence);
    if (Buffer.byteLength(evidenceText) > 128 * 1024) throw new Error('Historical evidence exceeds the reviewed bound.');
    return {mode:'unsigned-review',executable:false,cutoverAllowed:false,cloudErasureVerified:false,
      historicalCompletenessVerified:false,evidenceText,evidenceDigest:digest(evidenceText),
      recordedClaims:legacyDevices.length};
  } finally { database.close(); }
}
