import { AccountError, type AccountSession } from "./account-sessions";
import { accountClosureCommitAuthority } from "./account-closure-fence";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
type SpacePersonSession = Pick<AccountSession, "personId" | "sessionId"> & { closureAdmissionId?: string };
const inviteLifetime = 7 * 24 * 60 * 60 * 1000;
const credentialPattern = /^[a-f0-9]{64}$/;
const liveSession = `EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id = a.person_id
  WHERE a.id = ? AND a.person_id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
  AND a.authenticated_at >= p.credentials_changed_at)`;
const sharedSpace = `NOT EXISTS (SELECT 1 FROM personal_spaces ps WHERE ps.space_id = m.space_id)`;

// A shared-space roster is visible only through current person membership, never legacy credentials.
export async function listSpacePeople(database: D1Database, session: SpacePersonSession, spaceId: string, now = Date.now()) {
  const own = await database.prepare(`SELECT m.id, m.role, s.name FROM space_memberships m JOIN spaces s ON s.id = m.space_id
    WHERE m.person_id = ? AND m.space_id = ? AND m.revoked_at IS NULL AND ${sharedSpace} AND ${liveSession}`)
    .bind(session.personId, spaceId, session.sessionId, session.personId, now).first<{ id: string; role: string; name: string }>();
  if (!own) throw new AccountError(403, "Shared library access is not available.");
  const members = await database.prepare(`SELECT m.id, m.person_id AS personId, m.role, m.revision, p.display_name AS name,
    CASE WHEN ? = 'owner' OR p.id = ? THEN p.verified_email ELSE NULL END AS email
    FROM space_memberships m JOIN people p ON p.id = m.person_id WHERE m.space_id = ? AND m.revoked_at IS NULL
    AND p.disabled_at IS NULL ORDER BY m.created_at, m.id LIMIT 100`).bind(own.role, session.personId, spaceId).all();
  const invitations = own.role === "owner" ? (await database.prepare(`SELECT id, email, expires_at AS expiresAt FROM person_invitations
    WHERE space_id = ? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 20`)
    .bind(spaceId, now).all()).results : [];
  const legacy = own.role === "owner" ? await database.prepare(`SELECT COUNT(*) AS count FROM devices
    WHERE space_id = ? AND revoked_at IS NULL AND expires_at > ?`).bind(spaceId, now).first<{ count: number }>() : null;
  return { space: { id: spaceId, name: own.name }, currentMembershipId: own.id, role: own.role, members: members.results, invitations, legacyDevices: legacy?.count ?? null };
}

// Record authority evidence before the mutation in the same atomic batch. Concurrent last-owner changes serialize.
// Claimed legacy devices follow the person's revocation/demotion; other legacy devices remain separately identified.
export async function changeSpacePerson(database: D1Database, session: SpacePersonSession, spaceId: string,
  targetId: string, action: "owner" | "member" | "remove" | "leave", revision: number, now = Date.now()) {
  const eventId = crypto.randomUUID();
  const removing = action === "remove" || action === "leave";
  const admission = accountClosureCommitAuthority(session);
  const results = await database.batch([
    database.prepare(`INSERT INTO membership_events (id, space_id, actor_id, membership_id, action, created_at)
      SELECT ?, m.space_id, ?, m.id, ?, ? FROM space_memberships m JOIN people target ON target.id = m.person_id
      WHERE m.id = ? AND m.space_id = ? AND m.revision = ? AND m.revoked_at IS NULL AND ${sharedSpace}
      AND ${liveSession} AND (? <> 'owner' OR target.disabled_at IS NULL)
      AND ((? = 'leave' AND m.person_id = ?) OR (? <> 'leave' AND EXISTS
        (SELECT 1 FROM space_memberships actor WHERE actor.space_id = m.space_id AND actor.person_id = ? AND actor.role = 'owner' AND actor.revoked_at IS NULL)))
      AND (m.role <> 'owner' OR ? = 'owner' OR EXISTS (SELECT 1 FROM space_memberships remaining JOIN people p ON p.id = remaining.person_id
        WHERE remaining.space_id = m.space_id AND remaining.id <> m.id AND remaining.role = 'owner' AND remaining.revoked_at IS NULL AND p.disabled_at IS NULL)) AND ${admission.sql}`)
      .bind(eventId, session.personId, action, now, targetId, spaceId, revision, session.sessionId, session.personId, now,
        action, action, session.personId, action, session.personId, action, ...admission.bindings),
    database.prepare(`UPDATE space_memberships SET role = CASE WHEN ? THEN role ELSE ? END, revoked_at = CASE WHEN ? THEN ? ELSE NULL END,
      revision = revision + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM membership_events WHERE id = ?)`)
      .bind(removing ? 1 : 0, action, removing ? 1 : 0, now, targetId, eventId),
    database.prepare(`UPDATE devices SET role = CASE WHEN ? THEN role ELSE ? END, revoked_at = CASE WHEN ? THEN COALESCE(revoked_at, ?) ELSE revoked_at END
      WHERE id IN (SELECT device_id FROM legacy_owner_claims WHERE membership_id = ?) AND EXISTS (SELECT 1 FROM membership_events WHERE id = ?)`)
      .bind(removing ? 1 : 0, action, removing ? 1 : 0, now, targetId, eventId),
    database.prepare(`UPDATE invitations SET expires_at = 0 WHERE created_by IN (SELECT device_id FROM legacy_owner_claims WHERE membership_id = ?)
      AND EXISTS (SELECT 1 FROM membership_events WHERE id = ?)`).bind(targetId, eventId),
    database.prepare(`UPDATE person_invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE created_by = ? AND accepted_at IS NULL
      AND EXISTS (SELECT 1 FROM membership_events WHERE id = ?)`).bind(now, targetId, eventId),
  ]);
  if (!results[0].meta.changes) throw new AccountError(409, "Access changed, or this would leave the library without an owner. Refresh and review its people.");
  return { changed: true };
}

// Allocate one bounded, email-bound invitation; it grants Member access only after the recipient confirms.
export async function createPersonInvitation(database: D1Database, session: SpacePersonSession, spaceId: string, email: string, now = Date.now()) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const normalizedEmail = email.trim().toLowerCase();
  const admission = accountClosureCommitAuthority(session);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 320) throw new AccountError(400, "Enter a valid email address.");
  const result = await database.prepare(`INSERT INTO person_invitations (id, token_hash, space_id, created_by, email, created_at, expires_at)
    SELECT ?, ?, m.space_id, m.id, ?, ?, ? FROM space_memberships m WHERE m.person_id = ? AND m.space_id = ? AND m.role = 'owner'
    AND m.revoked_at IS NULL AND ${sharedSpace} AND ${liveSession}
    AND (SELECT COUNT(*) FROM person_invitations i WHERE i.space_id = m.space_id AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > ?) < 20
    AND NOT EXISTS (SELECT 1 FROM person_invitations i WHERE i.space_id = m.space_id AND i.email = ? AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > ?) AND ${admission.sql}`)
    .bind(id, await digest(token), normalizedEmail, now, now + inviteLifetime, session.personId, spaceId, session.sessionId, session.personId, now, now, normalizedEmail, now, ...admission.bindings).run();
  if (!result.meta.changes) throw new AccountError(409, "An invitation may already exist, the invitation limit was reached, or your access changed. Refresh and try again.");
  return { id, token, email: normalizedEmail, expiresAt: now + inviteLifetime };
}

// Revocation is owner-scoped and does not reveal foreign invitation identifiers.
export async function revokePersonInvitation(database: D1Database, session: SpacePersonSession, spaceId: string, id: string, now = Date.now()) {
  const admission = accountClosureCommitAuthority(session);
  await database.prepare(`UPDATE person_invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND space_id = ? AND EXISTS
    (SELECT 1 FROM space_memberships m WHERE m.space_id = person_invitations.space_id AND m.person_id = ? AND m.role = 'owner'
      AND m.revoked_at IS NULL AND ${sharedSpace} AND ${liveSession}) AND ${admission.sql}`)
    .bind(now, id, spaceId, session.personId, session.sessionId, session.personId, now, ...admission.bindings).run();
  return { revoked: true };
}

// Reusable SQL checks live issuer authority and recipient identity both in preview and in the accepting write.
const eligibleInvitation = `m.space_id = i.space_id AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > ?
  AND m.revoked_at IS NULL AND m.role = 'owner' AND issuer.disabled_at IS NULL AND ${sharedSpace}
  AND ${liveSession} AND i.email = (SELECT lower(verified_email) FROM people WHERE id = ?)
  AND NOT EXISTS (SELECT 1 FROM space_memberships old WHERE old.space_id = i.space_id AND old.person_id = ?
    AND (old.revoked_at IS NULL OR old.revoked_at >= i.created_at))
  AND (SELECT COUNT(*) FROM space_memberships active WHERE active.space_id = i.space_id AND active.revoked_at IS NULL) < 100`;

// Preview reveals the destination only to the invited, verified account and never grants membership.
export async function previewPersonInvitation(database: D1Database, session: SpacePersonSession, token: string, now = Date.now()) {
  if (!credentialPattern.test(token)) throw new AccountError(404, "This invitation is not available to this account.");
  const invitation = await database.prepare(`SELECT s.id AS spaceId, s.name AS spaceName, i.email, i.expires_at AS expiresAt
    FROM person_invitations i JOIN spaces s ON s.id = i.space_id JOIN space_memberships m ON m.id = i.created_by
    JOIN people issuer ON issuer.id = m.person_id WHERE i.token_hash = ? AND ${eligibleInvitation}`)
    .bind(await digest(token), now, session.sessionId, session.personId, now, session.personId, session.personId).first();
  if (!invitation) throw new AccountError(404, "This invitation expired, was used or is for a different verified account.");
  return { ...invitation, role: "member" };
}

// Consume and attach membership in one transaction. An older invitation cannot resurrect removed access.
// Explicit new invitations can rejoin a removed member, retaining stable upload attribution and audit evidence.
export async function acceptPersonInvitation(database: D1Database, session: SpacePersonSession, token: string, now = Date.now()) {
  if (!credentialPattern.test(token)) throw new AccountError(404, "This invitation is not available to this account.");
  const hash = await digest(token);
  const operation = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`UPDATE person_invitations SET accepted_at = ?, accepted_by = ?, accepted_operation = ? WHERE id IN
      (SELECT i.id FROM person_invitations i JOIN space_memberships m ON m.id = i.created_by JOIN people issuer ON issuer.id = m.person_id
        WHERE i.token_hash = ? AND ${eligibleInvitation}) RETURNING space_id AS spaceId`)
      .bind(now, session.personId, operation, hash, now, session.sessionId, session.personId, now, session.personId, session.personId),
    database.prepare(`INSERT INTO space_memberships (id, person_id, space_id, role, created_at)
      SELECT ?, ?, space_id, 'member', ? FROM person_invitations WHERE token_hash = ? AND accepted_by = ? AND accepted_operation = ?
      ON CONFLICT(person_id, space_id) DO UPDATE SET role = 'member', revoked_at = NULL, revision = space_memberships.revision + 1`)
      .bind(crypto.randomUUID(), session.personId, now, hash, session.personId, operation),
    database.prepare(`INSERT INTO membership_events (id, space_id, actor_id, membership_id, action, created_at)
      SELECT ?, m.space_id, ?, m.id, 'join', ? FROM space_memberships m JOIN person_invitations i ON i.space_id = m.space_id
      WHERE i.token_hash = ? AND m.person_id = ? AND i.accepted_by = ? AND i.accepted_operation = ?`)
      .bind(operation, session.personId, now, hash, session.personId, session.personId, operation),
  ]);
  if (!results[0].meta.changes) throw new AccountError(409, "This invitation is no longer available. Ask the library owner for a new one.");
  return { joined: true, spaceId: (results[0].results[0] as { spaceId: string }).spaceId };
}
