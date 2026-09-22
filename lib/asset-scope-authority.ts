import type { ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";

type ScopeAlias = "media" | "m" | "candidate" | "a";

// P4 preparation only: these predicates are not wired into production routes until the complete
// migration/disclosure inventory is ready. Every resource query includes current session authority.
export function resourceAudienceAuthority(device: ActiveDevice, alias: ScopeAlias = "media") {
  if (!["media", "m", "candidate", "a"].includes(alias)) throw new Error("Unsupported audience alias.");
  const live = transferAuthority(device, Date.now(), "read");
  const scope = audienceExpression(device, `${alias}.access_scope_id`);
  return { sql: `(${alias}.space_id=? AND ${live.sql} AND ${scope.sql})`, bindings: [device.space_id, ...live.bindings, ...scope.bindings] };
}

// An account's exact membership receives the grant. Role changes remain subject to current transfer
// authority; legacy claims never turn a paired credential into an account-scoped audience grant.
function audienceExpression(device: ActiveDevice, expression: string) {
  if (device.authentication !== "account") return { sql: `${expression} IS NULL`, bindings: [] as string[] };
  return { sql: `(${expression} IS NULL OR EXISTS (SELECT 1 FROM asset_scopes scope JOIN scope_grants grant ON grant.scope_id=scope.id
    JOIN account_space_actors scope_actor ON scope_actor.membership_id=grant.membership_id
    WHERE scope.id=${expression} AND scope.space_id=? AND scope_actor.device_id=? AND grant.revoked_at IS NULL))`,
    bindings: [device.space_id, device.id] };
}

// History retains the scopes of removed resources. Hide an entire mixed-scope event when any scope
// is unavailable, including from generic new-activity indicators and pagination.
export function eventAudienceAuthority(device: ActiveDevice) {
  const live = transferAuthority(device, Date.now(), "read"), scope = audienceExpression(device, "event_scope.value");
  return { sql: `(e.space_id=? AND ${live.sql} AND NOT EXISTS (SELECT 1 FROM json_each(e.scope_ids) event_scope WHERE NOT (${scope.sql})))`,
    bindings: [device.space_id, ...live.bindings, ...scope.bindings] };
}
