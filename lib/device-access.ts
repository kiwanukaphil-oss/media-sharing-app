import { ApiError, database, isLocal, requireOwner, type ActiveDevice } from "./server";
import type { DeviceRole } from "./contracts";
import { transferAuthority } from "./transfer-authority";

// Check the actor and last-owner invariant in the write itself so competing requests cannot orphan a space.
export async function changeDeviceAccess(device: ActiveDevice, targetId: string, nextRole?: DeviceRole) {
  const selfDisconnect = targetId === device.id && nextRole === undefined;
  if (!selfDisconnect) requireOwner(device);
  const now = Date.now();
  const authority = transferAuthority(device, now, !selfDisconnect);
  const target = await database().prepare("SELECT id FROM devices WHERE id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(targetId, device.space_id, now).first();
  if (!target) throw new ApiError(404, "This device is no longer connected.");
  const mutation = database().prepare(`UPDATE devices SET ${nextRole ? "role = ?" : "revoked_at = ?"}
    WHERE id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > ?
    AND EXISTS (SELECT 1 FROM devices AS actor WHERE actor.id = ? AND actor.space_id = ?
      AND actor.revoked_at IS NULL AND actor.expires_at > ? AND (actor.role = 'owner' OR ? = 1))
    AND (? = 'owner' OR role <> 'owner' OR EXISTS (
      SELECT 1 FROM devices AS other WHERE other.space_id = ? AND other.id <> devices.id
      AND other.role = 'owner' AND other.revoked_at IS NULL AND other.expires_at > ?)) AND ${authority.sql}`)
    .bind(nextRole || now, targetId, device.space_id, now, device.id, device.space_id, now,
      selfDisconnect ? 1 : 0, nextRole || "", device.space_id, now, ...authority.bindings);
  // Commit invitation invalidation with the access change, so a later promotion cannot revive old links.
  const invalidateInvitations = database().prepare(`UPDATE invitations SET redeemed_at = ?
    WHERE created_by = ? AND redeemed_at IS NULL AND changes() > 0 AND EXISTS (
      SELECT 1 FROM devices WHERE id = ? AND (role <> 'owner' OR revoked_at IS NOT NULL))`)
    .bind(now, targetId, targetId);
  const [result] = await database().batch(nextRole === "owner" ? [mutation] : [mutation, invalidateInvitations]);
  if (!result.meta.changes) throw new ApiError(409, "Keep at least one connected owner. Make another device an owner first, or refresh if access has changed.");
}

export function expiredSessionCookie(request: Request) {
  return `relay_device=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isLocal(request) ? "" : "; Secure"}`;
}
