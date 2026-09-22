import { AccountError, readAccountSession, readAccountToken } from "./account-sessions";
import type { Auth0Settings } from "./auth0-config";
import type { ActiveDevice } from "./server";

export type AccountSpaceAccess = ActiveDevice & { authentication: "account"; personId: string; sessionId: string };
const spaceIdentifier = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Explicit scope is carried by each request, including image/download URLs and queued transfers.
// Never fall back to the legacy cookie when a requested account space is invalid or inaccessible.
export function requestedAccountSpace(request: Request) {
  const query = new URL(request.url).searchParams.getAll("space");
  const header = request.headers.get("X-Relay-Space");
  if (!query.length && header === null) return null;
  if (query.length > 1 || (header !== null && query.length && header !== query[0])) {
    throw new AccountError(400, "Choose one library for this request.");
  }
  const spaceId = header ?? query[0];
  if (!spaceIdentifier.test(spaceId)) throw new AccountError(400, "Choose a valid library.");
  return spaceId;
}

// Compatibility attribution preserves existing media foreign keys without issuing device access.
// The expired, non-credential actor is stable across this person's sessions in this membership.
export async function requireAccountSpaceAccess(request: Request, database: D1Database,
  settings: Auth0Settings | null, now = Date.now()): Promise<AccountSpaceAccess | null> {
  const spaceId = requestedAccountSpace(request);
  if (!spaceId) return null;
  if (!settings) throw new AccountError(401, "Account library access is not available yet.");
  if (new URL(request.url).origin !== settings.appOrigin ||
      (request.method !== "GET" && request.headers.get("Origin") !== settings.appOrigin)) {
    throw new AccountError(403, "Open this library from Relay.");
  }
  const session = await readAccountSession(database, settings, readAccountToken(request), now);
  if (!session) throw new AccountError(401, "Sign in to your account to open this library.");
  const membership = await database.prepare(`SELECT m.id FROM space_memberships m
    LEFT JOIN personal_spaces ps ON ps.space_id = m.space_id
    WHERE m.person_id = ? AND m.space_id = ? AND m.revoked_at IS NULL AND m.role IN ('owner','member','editor','contributor','viewer')
    AND (ps.space_id IS NULL OR (ps.person_id = m.person_id AND m.role = 'owner'))`)
    .bind(session.personId, spaceId).first<{ id: string }>();
  if (!membership) throw new AccountError(403, "This library is not available to your account.");
  // Check authority inside each insert: an earlier session read cannot recreate attribution after
  // recovery or closure. Read the current name here rather than copying the cached session profile.
  const actorAuthority = `FROM space_memberships m JOIN people p ON p.id=m.person_id
    JOIN account_sessions a ON a.person_id=p.id LEFT JOIN personal_spaces ps ON ps.space_id=m.space_id
    WHERE m.id=? AND m.person_id=? AND m.space_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','member','editor','contributor','viewer')
    AND a.id=? AND a.revoked_at IS NULL AND a.expires_at>? AND p.disabled_at IS NULL
    AND a.authenticated_at>=p.credentials_changed_at
    AND (ps.space_id IS NULL OR (ps.person_id=p.id AND m.role='owner'))`;
  const actorBindings = [membership.id, session.personId, spaceId, session.sessionId, now];
  const existingActor = await database.prepare("SELECT device_id FROM account_space_actors WHERE membership_id = ?")
    .bind(membership.id).first();
  if (!existingActor) await database.batch([
    database.prepare(`INSERT INTO devices (id, space_id, name, token_hash, role, created_at, expires_at)
      SELECT m.id, m.space_id, p.display_name, 'account-attribution:' || m.id, 'member', ?, 0
      ${actorAuthority} ON CONFLICT(id) DO NOTHING`).bind(now, ...actorBindings),
    database.prepare(`INSERT INTO account_space_actors (membership_id, device_id)
      SELECT m.id, m.id ${actorAuthority} AND EXISTS (SELECT 1 FROM devices d
        WHERE d.id=m.id AND d.space_id=m.space_id AND d.expires_at=0 AND d.token_hash='account-attribution:' || m.id)
      ON CONFLICT(membership_id) DO NOTHING`).bind(...actorBindings),
  ]);
  // Recheck current session, identity and membership after actor creation, not cached role data.
  const access = await database.prepare(`SELECT d.id, s.id AS space_id, p.display_name AS name,
    s.name AS space_name, m.role, ps.quota_bytes AS storage_limit_bytes,
    CASE WHEN ps.space_id IS NULL THEN 'shared' ELSE 'personal' END AS space_kind FROM account_space_actors actor
    JOIN devices d ON d.id = actor.device_id JOIN space_memberships m ON m.id = actor.membership_id
    JOIN spaces s ON s.id = m.space_id JOIN people p ON p.id = m.person_id
    LEFT JOIN personal_spaces ps ON ps.space_id = s.id
    JOIN account_sessions a ON a.person_id = p.id
    WHERE m.id = ? AND m.person_id = ? AND m.space_id = ? AND m.revoked_at IS NULL AND m.role IN ('owner','member','editor','contributor','viewer')
    AND a.id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
    AND a.authenticated_at >= p.credentials_changed_at
    AND (ps.space_id IS NULL OR (ps.person_id = m.person_id AND m.role = 'owner'))
    AND d.space_id = m.space_id AND d.expires_at = 0 AND d.token_hash = ?`)
    .bind(membership.id, session.personId, spaceId, session.sessionId, now,
      `account-attribution:${membership.id}`).first<ActiveDevice>();
  if (!access) throw new AccountError(403, "This library is not available to your account.");
  return { ...access, authentication: "account", personId: session.personId, sessionId: session.sessionId };
}

// Relative transfer URLs must retain scope; browser-global selection is never transfer authority.
export function scopedTransferUrl(path: string, access: ActiveDevice) {
  return access.authentication === "account" ? `${path}?space=${encodeURIComponent(access.space_id)}` : path;
}
