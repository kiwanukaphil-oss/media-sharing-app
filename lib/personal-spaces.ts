import { AccountError, type AccountSession } from "./account-sessions";

export const PERSONAL_SPACE_BYTES = 1024 * 1024 * 1024;

// Allocation, rather than current usage, bounds the maximum storage promised to all accounts.
export function personalStorageBudget(environment: Record<string, string | undefined>) {
  const raw = environment.PERSONAL_STORAGE_BUDGET_BYTES ?? "0";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Invalid personal storage budget.");
  return Number(raw);
}

// Explicit creation is idempotent. The atomic batch prevents concurrent signups overbooking capacity.
export async function createPersonalSpace(database: D1Database, session: AccountSession, budget: number, now = Date.now()) {
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("Invalid personal storage budget.");
  const spaceId = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO spaces (id, name, created_at)
      SELECT ?, 'My space', ? WHERE NOT EXISTS (SELECT 1 FROM personal_spaces WHERE person_id = ?)
      AND (SELECT COALESCE(SUM(quota_bytes), 0) FROM personal_spaces) + ? <= ?
      AND EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id = a.person_id
        WHERE a.id = ? AND a.person_id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
        AND a.authenticated_at >= p.credentials_changed_at)`)
      .bind(spaceId, now, session.personId, PERSONAL_SPACE_BYTES, budget, session.sessionId, session.personId, now),
    database.prepare(`INSERT INTO personal_spaces (space_id, person_id, quota_bytes)
      SELECT id, ?, ? FROM spaces WHERE id = ?`).bind(session.personId, PERSONAL_SPACE_BYTES, spaceId),
    database.prepare(`INSERT INTO space_memberships (id, person_id, space_id, role, created_at)
      SELECT ?, person_id, space_id, 'owner', ? FROM personal_spaces WHERE space_id = ?`)
      .bind(crypto.randomUUID(), now, spaceId),
  ]);
  const result = await database.prepare(`SELECT s.id, s.name, ps.quota_bytes AS quotaBytes FROM personal_spaces ps
    JOIN spaces s ON s.id = ps.space_id JOIN space_memberships m ON m.space_id = ps.space_id AND m.person_id = ps.person_id
    JOIN account_sessions a ON a.person_id = ps.person_id JOIN people p ON p.id = ps.person_id
    WHERE ps.person_id = ? AND m.revoked_at IS NULL AND m.role = 'owner'
    AND a.id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
    AND a.authenticated_at >= p.credentials_changed_at`)
    .bind(session.personId, session.sessionId, now).first<{ id: string; name: string; quotaBytes: number }>();
  if (!result) throw new AccountError(409, "My space is not available right now. Your existing libraries are unchanged.");
  return { space: { ...result, kind: "personal" as const, role: "owner" as const } };
}
