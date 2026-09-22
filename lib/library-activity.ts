import { eventAudienceAuthority, requestedBrowseAudience } from "./asset-scope-authority";
import { ApiError, database, type ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";

import { activityStatement, type ActivityAction, type ActivityResource } from "./library-activity-statements";
export { fileActivityResources } from "./library-activity-statements";

export function activityBatch(device: ActiveDevice, action: ActivityAction, resources: ActivityResource[], statements: D1PreparedStatement[]) {
  const db = database();
  return db.batch([...statements, activityStatement(db, device, action, resources)]);
}

// Recheck live read authority inside the history query. Opaque references stay server-side; the UI
// receives no filenames, object keys, invitation contacts or private favourites. Cursor work is bounded.
export async function readLibraryActivity(request: Request, device: ActiveDevice) {
  const cursor = new URL(request.url).searchParams.get("before");
  let beforeTime = Number.MAX_SAFE_INTEGER, beforeId = "~";
  if (cursor) {
    const match = /^(\d{1,16}):([a-f0-9-]{36})$/.exec(cursor);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ApiError(400, "Refresh the activity list.");
    beforeTime = Number(match[1]); beforeId = match[2];
  }
  const authority = transferAuthority(device, Date.now(), "read");
  if (!await database().prepare(`SELECT 1 WHERE ${authority.sql}`).bind(...authority.bindings).first()) throw new ApiError(403, "Library access changed. Refresh to continue.");
  const eventAudience = eventAudienceAuthority(device), scope = requestedBrowseAudience(request, device);
  if (scope === false) throw new ApiError(400, "Choose a valid library audience.");
  const scopeFilter = scope === "accessible" ? "1" : scope === null ? "NOT EXISTS (SELECT 1 FROM json_each(e.scope_ids) WHERE value IS NOT NULL)" : "EXISTS (SELECT 1 FROM json_each(e.scope_ids) WHERE value=?)";
  const result = await database().prepare(`SELECT e.id,e.action,e.affected_count AS affectedCount,e.created_at AS createdAt,
    CASE WHEN e.actor_id=? THEN 'You' ELSE d.name END AS actor,
    EXISTS (SELECT 1 FROM json_each(e.resources) r WHERE json_extract(r.value,'$.revision') IS NOT NULL AND
      CASE json_extract(r.value,'$.kind') WHEN 'media' THEN
        COALESCE((SELECT revision FROM media WHERE id=json_extract(r.value,'$.id') AND space_id=e.space_id),-1)
      ELSE COALESCE((SELECT revision FROM albums WHERE id=json_extract(r.value,'$.id') AND space_id=e.space_id),-1) END
      <> json_extract(r.value,'$.revision')) AS changedSince
    FROM library_events e JOIN devices d ON d.id=e.actor_id AND d.space_id=e.space_id
    WHERE e.space_id=? AND (e.created_at<? OR (e.created_at=? AND e.id<?)) AND ${eventAudience.sql} AND ${scopeFilter}
    ORDER BY e.created_at DESC,e.id DESC LIMIT 31`)
    .bind(device.id, device.space_id, beforeTime, beforeTime, beforeId, ...eventAudience.bindings, ...(scope && scope !== "accessible" ? [scope] : [])).all();
  const events = result.results.slice(0, 30);
  const last = events.at(-1);
  return Response.json({ events, next: result.results.length > 30 && last ? `${last.createdAt}:${last.id}` : null });
}
