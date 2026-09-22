import { AccountError, type AccountSession } from "./account-sessions";
import { accountClosureCommitAuthority } from "./account-closure-fence";

const liveAccount = `EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id = a.person_id
  WHERE a.id = ? AND a.person_id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
  AND a.authenticated_at >= p.credentials_changed_at)`;
const soleOwnership = `SELECT s.id, s.name FROM space_memberships m JOIN spaces s ON s.id = m.space_id
  WHERE m.person_id = ? AND m.revoked_at IS NULL AND m.role = 'owner'
  AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = m.space_id)
  AND NOT EXISTS (SELECT 1 FROM space_memberships other JOIN people p ON p.id = other.person_id
    WHERE other.space_id = m.space_id AND other.person_id <> m.person_id AND other.role = 'owner'
    AND other.revoked_at IS NULL AND p.disabled_at IS NULL)`;

// Report the actual ownership blockers and stored request; preview never changes access or retention.
export async function previewAccountDeletion(database: D1Database, session: AccountSession, now = Date.now()) {
  const active = await database.prepare(`SELECT 1 WHERE ${liveAccount}`).bind(session.sessionId, session.personId, now).first();
  if (!active) throw new AccountError(401, "Sign in again to review account deletion.");
  const blockers = await database.prepare(soleOwnership).bind(session.personId).all();
  const request = await database.prepare(`SELECT id, requested_at AS requestedAt, status FROM account_deletion_requests
    WHERE person_id = ? ORDER BY requested_at DESC, id DESC LIMIT 1`).bind(session.personId).first();
  const authentication = await database.prepare("SELECT authenticated_at FROM account_sessions WHERE id = ?")
    .bind(session.sessionId).first<{ authenticated_at: number }>();
  return { request, ownershipBlockers: blockers.results, recentSignIn: !!authentication && authentication.authenticated_at >= now - 300_000 };
}

// Queue explicit, recently authenticated intent only after ownership handover. Nothing is erased or disabled.
// Operators must recheck current authority, shared-content policy and live/backup inventories before any execution.
export async function requestAccountDeletion(database: D1Database, session: AccountSession, now = Date.now()) {
  const id = crypto.randomUUID();
  const admission = accountClosureCommitAuthority(session);
  await database.prepare(`INSERT INTO account_deletion_requests (id, person_id, requested_at, updated_at, status)
    SELECT ?, ?, ?, ?, 'pending' WHERE ${liveAccount} AND EXISTS
      (SELECT 1 FROM account_sessions WHERE id = ? AND authenticated_at >= ?)
    AND NOT EXISTS (${soleOwnership}) AND ${admission.sql} ON CONFLICT DO NOTHING`)
    .bind(id, session.personId, now, now, session.sessionId, session.personId, now, session.sessionId, now - 300_000, session.personId, ...admission.bindings).run();
  const result = await previewAccountDeletion(database, session, now);
  if (!result.request || !["pending", "review_required"].includes(String(result.request.status))) {
    throw new AccountError(409, "Sign in again and hand over any library where you are the only owner before requesting deletion.");
  }
  return result;
}

// Withdrawal is account-scoped and preserves the request record for restore reconciliation.
export async function withdrawAccountDeletion(database: D1Database, session: AccountSession, id: string, now = Date.now()) {
  const admission = accountClosureCommitAuthority(session);
  const result = await database.prepare(`UPDATE account_deletion_requests SET status = 'withdrawn', updated_at = MAX(updated_at + 1, ?)
    WHERE id = ? AND person_id = ? AND status IN ('pending','review_required') AND ${liveAccount} AND ${admission.sql}`)
    .bind(now, id, session.personId, session.sessionId, session.personId, now, ...admission.bindings).run();
  if (!result.meta.changes) throw new AccountError(409, "This request changed. Refresh its status.");
  return previewAccountDeletion(database, session, now);
}
