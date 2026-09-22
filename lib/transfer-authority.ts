import type { ActiveDevice } from "./server";
import { closureAdmissionAuthority } from "./account-closure-fence";

// Embed this predicate in the same D1 statement that reserves or publishes transfer metadata.
// A previously authenticated request must not retain write authority after account/session/membership
// revocation. Inputs are server-resolved access, never client-supplied roles or identity identifiers.
function liveTransferAuthority(device: ActiveDevice, now = Date.now(), ownerOnly: boolean | "organiser" = false) {
  if (device.authentication === "account") {
    if (!device.personId || !device.sessionId) return { sql: "0", bindings: [] as (string | number)[] };
    return { sql: `EXISTS (SELECT 1 FROM account_space_actors actor
      JOIN devices d ON d.id=actor.device_id JOIN space_memberships m ON m.id=actor.membership_id
      JOIN people p ON p.id=m.person_id JOIN account_sessions a ON a.person_id=p.id
      LEFT JOIN personal_spaces ps ON ps.space_id=m.space_id
      WHERE d.id=? AND d.space_id=? AND m.space_id=d.space_id AND p.id=? AND a.id=?
      AND m.revoked_at IS NULL AND m.role IN ('owner','member','editor') AND p.disabled_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>?
      ${ownerOnly === "organiser" ? "AND m.role IN ('owner','editor')" : ownerOnly ? "AND m.role='owner'" : ""}
      AND a.authenticated_at>=p.credentials_changed_at
      AND d.expires_at=0 AND d.token_hash='account-attribution:' || m.id
      AND (ps.space_id IS NULL OR (ps.person_id=p.id AND m.role='owner')))`,
    bindings: [device.id,device.space_id,device.personId,device.sessionId,now] };
  }
  return { sql: `EXISTS (SELECT 1 FROM devices d WHERE d.id=? AND d.space_id=?
    AND d.revoked_at IS NULL AND d.role IN ('owner','member') AND d.expires_at>?
    ${ownerOnly ? "AND d.role='owner'" : ""}
    AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id=d.space_id))`,
  bindings: [device.id,device.space_id,now] };
}

// Couple the request's exact actor to its active generation in the same statement as the mutation.
// Default/untracked callers do not query the prototype tables; a settled or foreign admission cannot
// be reused even if the person's ordinary session is still valid.
export function transferAuthority(device: ActiveDevice, now = Date.now(), ownerOnly: boolean | "organiser" = false) {
  const live = liveTransferAuthority(device, now, ownerOnly);
  if (!device.closureAdmissionId) return live;
  const admission = closureAdmissionAuthority(device.closureAdmissionId);
  const actor = device.authentication === "account" ? "kind='account' AND person_id=?" : "kind='legacy' AND device_id=?";
  return { sql: `(${live.sql}) AND (${admission.sql}) AND EXISTS
    (SELECT 1 FROM closure_write_admissions WHERE id=? AND ${actor})`,
  bindings: [...live.bindings, ...admission.bindings, device.closureAdmissionId,
    device.authentication === "account" ? device.personId ?? "" : device.id] };
}
