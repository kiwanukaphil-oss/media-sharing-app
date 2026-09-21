import { AccountError, type AccountSession } from "./account-sessions";

type Session = Pick<AccountSession, "personId" | "sessionId">;
const ownerAuthority = `EXISTS (SELECT 1 FROM space_memberships m JOIN people p ON p.id = m.person_id
  JOIN account_sessions a ON a.person_id = p.id WHERE m.space_id = devices.space_id AND m.person_id = ?
  AND m.role = 'owner' AND m.revoked_at IS NULL AND p.disabled_at IS NULL AND a.id = ?
  AND a.revoked_at IS NULL AND a.expires_at > ? AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = m.space_id))`;

// Only a current account owner can reconcile legacy credentials; labels never establish personal identity.
export async function listLegacyAccess(database: D1Database, session: Session, spaceId: string, now = Date.now()) {
  const owner = await database.prepare(`SELECT m.id FROM space_memberships m JOIN people p ON p.id = m.person_id
    JOIN account_sessions a ON a.person_id = p.id WHERE m.space_id = ? AND m.person_id = ? AND m.role = 'owner'
    AND m.revoked_at IS NULL AND p.disabled_at IS NULL AND a.id = ? AND a.revoked_at IS NULL AND a.expires_at > ?
    AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = m.space_id)`)
    .bind(spaceId, session.personId, session.sessionId, now).first();
  if (!owner) throw new AccountError(403, "Only a library owner can review paired devices.");
  const devices = await database.prepare(`SELECT d.id, d.name, d.role, d.created_at AS createdAt, d.expires_at AS expiresAt,
    p.display_name AS linkedPerson FROM devices d LEFT JOIN legacy_owner_claims claim ON claim.device_id = d.id
    LEFT JOIN space_memberships m ON m.id = claim.membership_id LEFT JOIN people p ON p.id = m.person_id
    WHERE d.space_id = ? AND d.revoked_at IS NULL AND d.expires_at > ? ORDER BY d.created_at, d.id LIMIT 100`)
    .bind(spaceId, now).all();
  const total = await database.prepare("SELECT COUNT(*) AS count FROM devices WHERE space_id = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(spaceId, now).first<{ count: number }>();
  return { devices: devices.results, total: total?.count || 0 };
}

// A verified account owner remains in control even when retiring the last legacy owner credential.
// Revocation and unused pairing-link invalidation share one batch; no media or account memberships are deleted.
export async function revokeLegacyAccess(database: D1Database, session: Session, spaceId: string, targetId: string | null, now = Date.now()) {
  const results = await database.batch([
    database.prepare(`UPDATE devices SET revoked_at = ? WHERE space_id = ? AND (? IS NULL OR id = ?)
      AND revoked_at IS NULL AND expires_at > ? AND ${ownerAuthority}`)
      .bind(now, spaceId, targetId, targetId, now, session.personId, session.sessionId, now),
    database.prepare(`UPDATE invitations SET expires_at = 0 WHERE space_id = ? AND redeemed_at IS NULL
      AND created_by IN (SELECT id FROM devices WHERE space_id = ? AND revoked_at IS NOT NULL AND ${ownerAuthority})`)
      .bind(spaceId, spaceId, session.personId, session.sessionId, now),
  ]);
  if (!results[0].meta.changes) throw new AccountError(409, "Device access changed. Refresh and review the remaining devices.");
  return { revoked: results[0].meta.changes };
}
