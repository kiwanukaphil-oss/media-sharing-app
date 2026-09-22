import { createHash } from 'node:crypto';
import { importSnapshot, checkDatabase, sanitizeRestoredAccess } from './relay-backup.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from './backup-d1-readonly.mjs';
import {minimiseIntakeIdentity} from './intake-lifecycle.mjs';
import { reviewMinimisationSchema } from './review-minimisation-schema.mjs';

export const providerIdentityDigest = (issuer, subject) => createHash('sha256').update(JSON.stringify([issuer, subject])).digest('hex');

// This helper accepts SQL text and always writes to a new in-memory database. It cannot mutate live D1,
// the input snapshot, cloud originals, or Auth0. Receipts must come from a separately verified erasure ledger.
// A transformed snapshot remains quarantined until every external object/backup/provider check is complete.
export function minimiseErasedSnapshot(sql, receipt, now = Date.now()) {
  if (!receipt || receipt.formatVersion !== 1 || typeof receipt.personId !== 'string' || !receipt.personId ||
      !/^[a-f0-9]{64}$/.test(receipt.identityDigest ?? '') || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error('Invalid erasure reconciliation receipt.');
  }
  const database = importSnapshot(sql);
  try {
    const person = database.prepare('SELECT * FROM people WHERE id=?').get(receipt.personId);
    if (!person) throw new Error('Identity not found; historical ownership needs explicit reconciliation.');
    const alreadyMinimised = person.issuer === 'urn:relay:erased' && person.subject === receipt.identityDigest;
    if (!alreadyMinimised && providerIdentityDigest(person.issuer, person.subject) !== receipt.identityDigest) {
      throw new Error('Erasure receipt does not match the historical identity.');
    }
    // Missing/older schema fails instead of silently skipping a newly introduced identity reference.
    const shape = database.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'
      AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name`).all().map(({name}) =>
      [name, database.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    // Protocol tables are accepted only in the reviewed global-backup-only stage, with no account,
    // device, fence or storage-effect references. All other additions still require explicit review.
    if (!reviewMinimisationSchema(database, shape).accepted) throw new Error('Snapshot schema requires erasure review.');
    database.exec('BEGIN');
    const personId = receipt.personId;
    minimiseIntakeIdentity(database,personId,person.verified_email,now);
    const personal = 'SELECT space_id FROM personal_spaces WHERE person_id=?';
    const actors = `SELECT device_id FROM account_space_actors WHERE membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)
      UNION SELECT device_id FROM legacy_owner_claims WHERE membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)`;
    // Private history goes with its space; shared history has no historical names and resolves the
    // existing actor after the Deleted member minimisation below.
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='library_events'").get())
      database.prepare(`DELETE FROM library_events WHERE space_id IN(${personal})`).run(personId);
    // Newer schemas retain personal navigation separately; it must not survive person erasure.
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='personal_favorites'").get())
      database.prepare(`DELETE FROM personal_favorites WHERE person_id=? OR media_id IN(SELECT id FROM media WHERE space_id IN(${personal}))`).run(personId,personId);
    // Revoke exact-membership grants explicitly as well as through the departure trigger. Shared
    // scope labels and audit references follow the same retained-content policy as shared albums.
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='scope_grants'").get())
      database.prepare('UPDATE scope_grants SET revoked_at=COALESCE(revoked_at,?) WHERE membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)').run(now,personId);
    const sharedBefore = JSON.stringify(database.prepare(`SELECT * FROM media WHERE space_id NOT IN(${personal}) ORDER BY id`).all(personId));
    database.prepare(`DELETE FROM album_media WHERE album_id IN(SELECT id FROM albums WHERE space_id IN(${personal}))
      OR media_id IN(SELECT id FROM media WHERE space_id IN(${personal}))`).run(personId,personId);
    database.prepare(`DELETE FROM albums WHERE space_id IN(${personal})`).run(personId);
    database.prepare(`DELETE FROM media WHERE space_id IN(${personal})`).run(personId);
    database.prepare(`DELETE FROM publication_attempts WHERE publication_id IN(SELECT id FROM publications WHERE person_id=?)`).run(personId);
    database.prepare(`UPDATE publications SET attempt_key=NULL,lease_expires_at=0,
      phase=CASE WHEN phase='ready' THEN 'ready' ELSE 'cancelled' END WHERE person_id=?`).run(personId);
    database.prepare(`DELETE FROM owner_claim_attempts WHERE session_id IN(SELECT id FROM account_sessions WHERE person_id=?)`).run(personId);
    database.prepare(`UPDATE invitations SET expires_at=0,redeemed_at=COALESCE(redeemed_at,?) WHERE created_by IN(${actors})
      OR space_id IN(${personal})`).run(now,personId,personId,personId);
    database.prepare(`UPDATE devices SET name='Deleted member',token_hash='erased-device:' || id,expires_at=0,
      revoked_at=COALESCE(revoked_at,?) WHERE id IN(${actors}) OR space_id IN(${personal})`).run(now,personId,personId,personId);
    database.prepare(`UPDATE account_sessions SET token_hash='erased-session:' || id,configuration_hash='',
      provider_session_id=NULL,expires_at=0,revoked_at=COALESCE(revoked_at,?) WHERE person_id=?`).run(now,personId);
    database.prepare('UPDATE space_memberships SET revoked_at=COALESCE(revoked_at,?) WHERE person_id=?').run(now,personId);
    // Exact identity references determine authority. Email matching only minimises the stored contact field;
    // it never grants membership, deletes another person, or recalls a published shared original.
    database.prepare(`UPDATE person_invitations SET email='',token_hash='erased-invitation:' || id,expires_at=0,
      revoked_at=COALESCE(revoked_at,?) WHERE accepted_by=? OR (?<>'' AND lower(email)=lower(?))`).run(now,personId,person.verified_email,person.verified_email);
    database.prepare(`UPDATE spaces SET name='Deleted personal space' WHERE id IN(${personal})`).run(personId);
    database.prepare('DELETE FROM recovery_watermarks WHERE issuer=? AND subject=?').run(person.issuer,person.subject);
    database.prepare(`UPDATE people SET issuer='urn:relay:erased',subject=?,display_name='Deleted member',verified_email='',
      disabled_at=COALESCE(disabled_at,?),credentials_changed_at=0 WHERE id=?`).run(receipt.identityDigest,now,personId);
    checkDatabase(database);
    const sharedAfter = JSON.stringify(database.prepare(`SELECT * FROM media WHERE space_id NOT IN(${personal}) ORDER BY id`).all(personId));
    if (sharedBefore !== sharedAfter) throw new Error('Shared original records changed during minimisation.');
    database.exec('COMMIT');
    sanitizeRestoredAccess(database, now);
    const exportPlan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
    const outputSql = restoreReadOnlySnapshot(exportPlan, database.prepare(exportPlan.sql).all());
    return { sql:outputSql, mode:'isolated-review', cutoverAllowed:false, cloudErasureVerified:false,
      sourceDigest:createHash('sha256').update(sql).digest('hex') };
  } finally { database.close(); }
}
