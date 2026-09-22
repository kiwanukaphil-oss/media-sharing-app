import { z } from "zod";
import { ApiError, database, readJson, type ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";
import { newAssetAudienceAuthority } from "./asset-scope-authority";

// Routes remain behind a disabled activation flag until the complete disclosure inventory is ready.
// Audience administration is account-owner-only and cannot target another person's personal space.
function scopeAdministrator(device: ActiveDevice) {
  if (device.authentication !== "account" || !device.personId) throw new ApiError(403, "Sign in as a shared-space owner to manage audiences.");
  const owner = transferAuthority(device, Date.now(), true);
  return { sql: `(${owner.sql} AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id=?))`,
    bindings: [...owner.bindings, device.space_id] };
}

const currentScopeVersion = "(SELECT id FROM asset_scope_events WHERE scope_id=asset_scopes.id ORDER BY rowid DESC LIMIT 1)";

// Ordinary readers see only explicitly granted names. The separate owner catalog returns opaque
// administrative identifiers, never restricted titles, file counts, covers or content history.
export async function readAccessScopes(device: ActiveDevice, administration = false) {
  const db = database(), live = administration ? scopeAdministrator(device) : transferAuthority(device, Date.now(), "read");
  if (!await db.prepare(`SELECT 1 WHERE ${live.sql}`).bind(...live.bindings).first()) throw new ApiError(403, "Library access changed.");
  const audience = administration ? "1" : `EXISTS (SELECT 1 FROM scope_grants g JOIN account_space_actors a ON a.membership_id=g.membership_id WHERE g.scope_id=asset_scopes.id AND a.device_id=? AND g.revoked_at IS NULL)`;
  if (!administration && device.authentication !== "account") return { scopes: [] };
  const records = await db.prepare(`SELECT id,created_by AS createdBy,${currentScopeVersion} AS version${administration ? "" : ",name"}
    FROM asset_scopes WHERE space_id=? AND ${live.sql} AND ${audience} ORDER BY created_at,id LIMIT 101`)
    .bind(device.space_id, ...live.bindings, ...(administration ? [] : [device.id])).all();
  if (records.results.length > 100) throw new ApiError(409, "This audience list needs an administrative review.");
  const grants = administration ? await db.prepare(`SELECT g.scope_id AS scopeId,g.membership_id AS membershipId,g.created_at AS grantedAt
    FROM scope_grants g JOIN asset_scopes s ON s.id=g.scope_id WHERE s.space_id=? AND g.revoked_at IS NULL AND ${live.sql}
    ORDER BY g.scope_id,g.membership_id LIMIT 5001`).bind(device.space_id,...live.bindings).all() : null;
  if (grants && grants.results.length>5000) throw new ApiError(409,"This grant list needs an administrative review.");
  return { scopes: records.results, ...(grants ? { grants: grants.results } : {}) };
}

// The preview sends exact membership IDs, including the creator. One transaction either creates the
// complete audience and its audit or nothing. Stable IDs permit retry without adopting another scope.
export async function createAccessScope(request: Request, device: ActiveDevice) {
  const authority = scopeAdministrator(device), db = database();
  const input = await readJson(request, z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100),
    members: z.array(z.string().uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length), confirmAudience: z.literal(true) }));
  const ownMembership = await db.prepare('SELECT membership_id FROM account_space_actors WHERE device_id=?').bind(device.id).first<{ membership_id: string }>();
  if (!ownMembership || !input.members.includes(ownMembership.membership_id)) throw new ApiError(400, "Include your current membership in the initial audience.");
  const now = Date.now(), eventId = crypto.randomUUID(), members = JSON.stringify(input.members);
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO asset_scopes(id,space_id,name,created_by,created_at) SELECT ?,?,?,?,? WHERE ${authority.sql}
      AND (SELECT COUNT(*) FROM asset_scopes WHERE space_id=?)<100
      AND (SELECT COUNT(*) FROM space_memberships m JOIN json_each(?) selected ON selected.value=m.id JOIN people p ON p.id=m.person_id
        WHERE m.space_id=? AND m.revoked_at IS NULL AND p.disabled_at IS NULL)=?`)
      .bind(input.id,device.space_id,input.name,ownMembership.membership_id,now,...authority.bindings,device.space_id,members,device.space_id,input.members.length),
    db.prepare("INSERT INTO asset_scope_events(id,scope_id,actor_id,action,created_at) SELECT ?,?,?,'create',? WHERE changes()=1")
      .bind(eventId,input.id,device.personId!,now),
    db.prepare(`INSERT INTO scope_grants(scope_id,membership_id,granted_by,created_at) SELECT ?,value,?,? FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM asset_scope_events WHERE id=?)`).bind(input.id,device.personId!,now,members,eventId),
  ]);
  const audience = newAssetAudienceAuthority(device,input.id);
  const matching = await db.prepare(`SELECT id,${currentScopeVersion} AS version FROM asset_scopes WHERE id=? AND space_id=? AND name=? AND created_by=?
    AND ${authority.sql} AND ${audience.sql} AND (SELECT COUNT(*) FROM scope_grants WHERE scope_id=asset_scopes.id AND revoked_at IS NULL)=?
    AND NOT EXISTS (SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS (SELECT 1 FROM scope_grants WHERE scope_id=asset_scopes.id AND membership_id=selected.value AND revoked_at IS NULL))`)
    .bind(input.id,device.space_id,input.name,ownMembership.membership_id,...authority.bindings,...audience.bindings,input.members.length,members).first();
  if (!matching) throw new ApiError(409, "The audience or your access changed. Review it again.");
  return Response.json({ scope: matching, created: Boolean(results[0].meta.changes) });
}

// A version is the last opaque audit-event ID. Check it in the committing statement so two open
// management dialogs cannot silently overwrite each other's grant decisions. Self-access is explicit.
export async function changeScopeGrant(request: Request, device: ActiveDevice, scopeId: string) {
  const authority = scopeAdministrator(device), db = database();
  const input = await readJson(request, z.object({ membershipId:z.string().uuid(),version:z.string().uuid(),grant:z.boolean(),confirmAudience:z.literal(true),confirmAdministratorAccess:z.boolean().optional() }));
  const own = await db.prepare('SELECT membership_id FROM account_space_actors WHERE device_id=?').bind(device.id).first<{membership_id:string}>();
  if (input.grant && input.membershipId===own?.membership_id && input.confirmAdministratorAccess!==true) throw new ApiError(400, "Confirm your own administrator access explicitly.");
  const now=Date.now(), eventId=crypto.randomUUID();
  const guard=`EXISTS (SELECT 1 FROM asset_scopes WHERE id=? AND space_id=? AND ${currentScopeVersion}=? AND ${authority.sql})`;
  const values=[scopeId,device.space_id,input.version,...authority.bindings];
  const mutation=input.grant ? db.prepare(`INSERT INTO scope_grants(scope_id,membership_id,granted_by,created_at,revoked_at)
    SELECT ?,?,?,?,NULL WHERE ${guard} AND (SELECT COUNT(*) FROM scope_grants WHERE scope_id=? AND revoked_at IS NULL)<50 AND EXISTS (SELECT 1 FROM space_memberships m JOIN people p ON p.id=m.person_id WHERE m.id=? AND m.space_id=? AND m.revoked_at IS NULL AND p.disabled_at IS NULL)
    ON CONFLICT(scope_id,membership_id) DO UPDATE SET granted_by=excluded.granted_by,created_at=excluded.created_at,revoked_at=NULL WHERE scope_grants.revoked_at IS NOT NULL`)
    .bind(scopeId,input.membershipId,device.personId!,now,...values,scopeId,input.membershipId,device.space_id)
    : db.prepare(`UPDATE scope_grants SET revoked_at=? WHERE scope_id=? AND membership_id=? AND revoked_at IS NULL AND ${guard}`).bind(now,scopeId,input.membershipId,...values);
  const action=input.grant ? input.membershipId===own?.membership_id ? "administrator-grant" : "grant" : "revoke";
  const [changed]=await db.batch([mutation,db.prepare('INSERT INTO asset_scope_events(id,scope_id,actor_id,membership_id,action,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1')
    .bind(eventId,scopeId,device.personId!,input.membershipId,action,now)]);
  if (!changed.meta.changes) throw new ApiError(409, "The audience changed or this grant is already in that state. Refresh before continuing.");
  return Response.json({version:eventId});
}
