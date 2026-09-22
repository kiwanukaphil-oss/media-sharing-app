import type { ActiveDevice } from "./server";

type StoragePool = { spaceIds: string[]; limitBytes: number };

// Only operator configuration can join billing; a pool never changes a file's audience or membership.
export function storagePoolForSpace(spaceId: string, environment = process.env): StoragePool | null {
  const raw = environment.RELAY_STORAGE_POOL;
  if (!raw) return null;
  let pool: StoragePool;
  try { pool = JSON.parse(raw); } catch { throw new Error("Storage pool configuration is invalid."); }
  if (!pool || Object.keys(pool).sort().join() !== "limitBytes,spaceIds" || !Array.isArray(pool.spaceIds) ||
      pool.spaceIds.length !== 2 || new Set(pool.spaceIds).size !== 2 ||
      pool.spaceIds.some(id => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) ||
      !Number.isSafeInteger(pool.limitBytes) || pool.limitBytes < 1 || pool.limitBytes > 100 * 1024 ** 3) {
    throw new Error("Storage pool configuration is invalid.");
  }
  return pool.spaceIds.includes(spaceId) ? pool : null;
}

// Embed this predicate in the same statement as every reservation, so concurrent spaces share one atomic limit.
export function storageQuota(spaceId: string, fallbackLimit: number) {
  const pool = storagePoolForSpace(spaceId), spaceIds = pool?.spaceIds || [spaceId];
  return { sql: `space_id IN (${spaceIds.map(() => "?").join(",")})`, bindings: spaceIds,
    limit: pool?.limitBytes ?? fallbackLimit, pooled: Boolean(pool) };
}

// Exact combined usage is visible only to the current signed-in owner of every pooled library.
// Other members retain their own library totals and learn neither personal usage nor private file details.
export async function readStoragePoolSummary(database: D1Database, device: ActiveDevice, now = Date.now()) {
  const pool = storagePoolForSpace(device.space_id);
  if (!pool) return {};
  if (device.authentication !== "account" || !device.personId || !device.sessionId) return { pooled: true };
  const quota = storageQuota(device.space_id, pool.limitBytes);
  const total = await database.prepare(`SELECT COALESCE(SUM(size+preview_size),0) AS used FROM media
    WHERE ${quota.sql} HAVING EXISTS(SELECT 1 FROM account_sessions a JOIN people p ON p.id=a.person_id
      WHERE a.id=? AND a.person_id=? AND a.revoked_at IS NULL AND a.expires_at>? AND p.disabled_at IS NULL
      AND a.authenticated_at>=p.credentials_changed_at)
    AND (SELECT COUNT(DISTINCT m.space_id) FROM space_memberships m LEFT JOIN personal_spaces ps ON ps.space_id=m.space_id
      WHERE m.space_id IN (?,?) AND m.person_id=? AND m.role='owner' AND m.revoked_at IS NULL
      AND (ps.space_id IS NULL OR ps.person_id=m.person_id))=2`)
    .bind(...quota.bindings, device.sessionId, device.personId, now, ...pool.spaceIds, device.personId).first<{ used: number }>();
  return total ? { pooled: true, poolUsed: total.used } : { pooled: true };
}
