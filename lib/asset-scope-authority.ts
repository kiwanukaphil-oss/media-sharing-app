import type { ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";

type ScopeAlias = "media" | "m" | "candidate" | "a" | "albums" | "upload_requests" | "delivery_snapshots";

// Every resource query includes current session authority. Scope creation remains disabled until
// the complete migration/disclosure inventory and release checks have passed.
export function resourceAudienceAuthority(device: ActiveDevice, alias: ScopeAlias = "media") {
  if (!["media", "m", "candidate", "a", "albums", "upload_requests", "delivery_snapshots"].includes(alias)) throw new Error("Unsupported audience alias.");
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

// General browsing is deliberate even when a person has narrower grants. A combined view must be
// explicitly requested; malformed/duplicate selectors cannot silently fall back to a wider audience.
export function requestedBrowseAudience(request: Request, device: ActiveDevice): string | null | false {
  const values = new URL(request.url).searchParams.getAll("scope");
  if (values.length > 1) return false;
  const value = values[0] || "";
  if (!value) return null;
  if (device.authentication !== "account") return false;
  return value === "accessible" || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : false;
}

export function browseAudienceAuthority(device: ActiveDevice, scope: string | null, alias: ScopeAlias = "media") {
  const audience = resourceAudienceAuthority(device, alias);
  if (scope === "accessible") return audience;
  return { sql: `(${audience.sql} AND ${alias}.access_scope_id IS ?)`, bindings: [...audience.bindings, scope] };
}

// Use a resource-bound predicate where both standalone preflight and committing SQL need the same
// live role and grant check. Binding the ID avoids depending on the outer statement's table alias.
export function mediaOperationAuthority(device: ActiveDevice, mediaId: string, role: boolean | "organiser" | "read" = false) {
  const permission = transferAuthority(device, Date.now(), role), audience = resourceAudienceAuthority(device, "m");
  return { sql: `(${permission.sql} AND EXISTS (SELECT 1 FROM media m WHERE m.id=? AND ${audience.sql}))`,
    bindings: [...permission.bindings, mediaId, ...audience.bindings] };
}

// New uploads have no media row yet. Check their explicit immutable scope before reserving bytes.
export function newAssetAudienceAuthority(device: ActiveDevice, scopeId: string | null) {
  if (scopeId === null) return { sql: "1", bindings: [] as string[] };
  if (device.authentication !== "account") return { sql: "0", bindings: [] as string[] };
  const scope = audienceExpression(device, "scope_candidate.id");
  return { sql: `EXISTS (SELECT 1 FROM asset_scopes scope_candidate WHERE scope_candidate.id=? AND scope_candidate.space_id=? AND ${scope.sql})`,
    bindings: [scopeId, device.space_id, ...scope.bindings] };
}
