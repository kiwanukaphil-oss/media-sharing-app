import { AccountError, type AccountSession } from "./account-sessions";
import { accountClosureCommitAuthority } from "./account-closure-fence";

const hashCredential = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const validCredential = (value: string) => /^[a-f0-9]{64}$/.test(value);
const claimLifetime = 5 * 60 * 1000;
const recentSignInLifetime = 10 * 60 * 1000;
type ClaimCandidate = { deviceId: string; spaceId: string; spaceName: string; deviceName: string };

// Browser owner claims accept exactly one legacy cookie, never a bearer or caller-supplied device ID.
export function readLegacyClaimCredential(request: Request) {
  const values = (request.headers.get("Cookie") || "").split(";").map(part => part.trim())
    .filter(part => part.startsWith("relay_device=")).map(part => part.slice(13));
  return values.length === 1 && validCredential(values[0]) ? values[0] : null;
}

// Listing follows current memberships, so sign-in alone never enumerates existing shared spaces.
export async function listPersonSpaces(database: D1Database, session: AccountSession) {
  const spaces = await database.prepare(`SELECT spaces.id, spaces.name, m.role, CASE WHEN ps.space_id IS NULL THEN 'shared' ELSE 'personal' END AS kind, actor.device_id AS actorId FROM space_memberships m
    JOIN spaces ON spaces.id = m.space_id LEFT JOIN personal_spaces ps ON ps.space_id = spaces.id
    LEFT JOIN account_space_actors actor ON actor.membership_id = m.id
    WHERE m.person_id = ? AND m.revoked_at IS NULL AND (ps.space_id IS NULL OR (ps.person_id = m.person_id AND m.role = 'owner'))
    ORDER BY spaces.name, spaces.id LIMIT 100`).bind(session.personId).all();
  return spaces.results;
}

// A preview proves current owner authority without linking any account or changing a device.
export async function prepareOwnerClaim(database: D1Database, session: AccountSession, legacyToken: string | null, now = Date.now()) {
  if (!legacyToken || !validCredential(legacyToken)) throw new AccountError(403, "Open this account from a connected owner browser.");
  if (session.createdAt < now - recentSignInLifetime) throw new AccountError(403, "Sign in again before connecting this library to your account.");
  const admission = accountClosureCommitAuthority(session);
  const candidateQuery = `SELECT d.id AS deviceId, d.space_id AS spaceId, s.name AS spaceName, d.name AS deviceName
    FROM devices d JOIN spaces s ON s.id = d.space_id WHERE d.token_hash = ? AND d.role = 'owner'
    AND d.revoked_at IS NULL AND d.expires_at > ?
    AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = d.space_id)
    AND NOT EXISTS (SELECT 1 FROM legacy_owner_claims c WHERE c.device_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM space_memberships m WHERE m.person_id = ? AND m.space_id = d.space_id)
    AND EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id=a.person_id
      WHERE a.id=? AND a.person_id=? AND a.revoked_at IS NULL AND a.expires_at>?
      AND a.created_at>=? AND p.disabled_at IS NULL AND a.authenticated_at>=p.credentials_changed_at) AND ${admission.sql}`;
  const candidateBindings = [await hashCredential(legacyToken), now, session.personId,
    session.sessionId, session.personId, now, now - recentSignInLifetime, ...admission.bindings];
  const candidate = await database.prepare(candidateQuery).bind(...candidateBindings).first<ClaimCandidate>();
  if (!candidate) throw new AccountError(409, "This browser cannot connect this library, or it has already been connected. Refresh your account.");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  // Re-evaluate both authorities in the insert after asynchronous token hashing and the preview read.
  const results = await database.batch([
    database.prepare("DELETE FROM owner_claim_attempts WHERE expires_at <= ?").bind(now),
    database.prepare(`INSERT INTO owner_claim_attempts (token_hash, session_id, device_id, space_id, expires_at)
      SELECT ?, ?, candidate.deviceId, candidate.spaceId, ? FROM (${candidateQuery}) candidate
      WHERE candidate.deviceId=? AND candidate.spaceId=?`)
      .bind(await hashCredential(token), session.sessionId, now + claimLifetime, ...candidateBindings, candidate.deviceId, candidate.spaceId),
  ]);
  if (!results[1].meta.changes) throw new AccountError(409, "Access changed. Review the library connection again.");
  return { ...candidate, token, expiresAt: now + claimLifetime, accountEmail: session.verifiedEmail, role: "owner" as const };
}

// The batch commits the membership, immutable claim evidence and token consumption together.
// Recheck live device/session authority in SQL; a stale preview or concurrent claim grants nothing.
export async function confirmOwnerClaim(database: D1Database, session: AccountSession, legacyToken: string | null, token: string, now = Date.now()) {
  if (!legacyToken || !validCredential(legacyToken) || !validCredential(token)) throw new AccountError(400, "This library connection has expired. Review it again.");
  const membershipId = crypto.randomUUID();
  const tokenHash = await hashCredential(token);
  const admission = accountClosureCommitAuthority(session);
  const results = await database.batch([
    database.prepare(`INSERT INTO space_memberships (id, person_id, space_id, role, created_at)
      SELECT ?, a.person_id, c.space_id, 'owner', ? FROM owner_claim_attempts c
      JOIN devices d ON d.id = c.device_id AND d.space_id = c.space_id
      JOIN account_sessions a ON a.id = c.session_id JOIN people p ON p.id = a.person_id
      WHERE c.token_hash = ? AND c.session_id = ? AND a.person_id = ? AND c.consumed_at IS NULL AND c.expires_at > ?
      AND d.token_hash = ? AND d.role = 'owner' AND d.revoked_at IS NULL AND d.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = d.space_id)
      AND a.revoked_at IS NULL AND a.expires_at > ? AND a.created_at >= ? AND p.disabled_at IS NULL
      AND a.authenticated_at >= p.credentials_changed_at
      AND NOT EXISTS (SELECT 1 FROM legacy_owner_claims prior WHERE prior.device_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM space_memberships prior WHERE prior.person_id = a.person_id AND prior.space_id = c.space_id) AND ${admission.sql}`)
      .bind(membershipId, now, tokenHash, session.sessionId, session.personId, now, await hashCredential(legacyToken), now, now, now - recentSignInLifetime, ...admission.bindings),
    database.prepare(`INSERT INTO legacy_owner_claims (device_id, membership_id, session_id, claimed_at)
      SELECT c.device_id, ?, c.session_id, ? FROM owner_claim_attempts c WHERE c.token_hash = ?
      AND EXISTS (SELECT 1 FROM space_memberships WHERE id = ?)`)
      .bind(membershipId, now, tokenHash, membershipId),
    database.prepare(`UPDATE owner_claim_attempts SET consumed_at = ? WHERE token_hash = ? AND session_id = ?
      AND EXISTS (SELECT 1 FROM space_memberships WHERE id = ?)`)
      .bind(now, tokenHash, session.sessionId, membershipId),
  ]);
  if (!results[0].meta.changes) throw new AccountError(409, "Access changed or this connection was already used. Review the library connection again.");
  return { connected: true, membershipId };
}
