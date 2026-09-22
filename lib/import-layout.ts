import { newAssetAudienceAuthority } from "./asset-scope-authority";
import { z } from "zod";
import { ApiError, database, readJson, requireOrganiser, type ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";
import { activityStatement } from "./library-activity-statements";

// A preview supplies stable UUIDs so retrying a lost response cannot create duplicate albums. Only
// the exact creator's unchanged layout can be reused; no existing album is overwritten or adopted.
export async function createImportLayout(request: Request, device: ActiveDevice) {
  requireOrganiser(device);
  const name = z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f]/.test(value));
  const input = await readJson(request, z.object({ id: z.string().uuid(), name, accessScopeId: z.string().uuid().nullable().optional(), sections: z.array(z.object({ id: z.string().uuid(), name })).max(50) }));
  if (new Set(input.sections.map(section => section.id)).size !== input.sections.length || new Set(input.sections.map(section => section.name.toLowerCase())).size !== input.sections.length)
    throw new ApiError(400, "Give each section a distinct name.");
  const db = database(), now = Date.now(), eventId = crypto.randomUUID(), authority = transferAuthority(device, now, "organiser");
  const scopeId = input.accessScopeId ?? null, audience = newAssetAudienceAuthority(device, scopeId);
  const sections = JSON.stringify(input.sections.map((section, position) => ({ ...section, position: position * 10 })));
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO albums(id,space_id,name,description,created_at,access_scope_id) SELECT ?,?,?,'',?,? WHERE ${authority.sql} AND ${audience.sql}`)
      .bind(input.id, device.space_id, input.name, now, scopeId, ...authority.bindings, ...audience.bindings),
    activityStatement(db, device, "album.create", [{ kind: "album", id: input.id, revision: 0 }], eventId),
    db.prepare(`INSERT INTO album_sections(album_id,id,name,position) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.position')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM library_events WHERE id=?)`).bind(input.id, sections, eventId),
  ]);
  const layout = await db.prepare(`SELECT id,name FROM albums WHERE id=? AND space_id=? AND name=? AND description='' AND revision=0
    AND archived_at IS NULL AND deleted_at IS NULL AND access_scope_id IS ? AND ${authority.sql} AND ${audience.sql}
    AND EXISTS (SELECT 1 FROM library_events e WHERE e.space_id=albums.space_id AND e.actor_id=? AND e.action='album.create'
      AND json_extract(e.resources,'$[0].id')=albums.id)
    AND (SELECT COUNT(*) FROM album_sections WHERE album_id=albums.id)=?
    AND NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS (SELECT 1 FROM album_sections s WHERE s.album_id=albums.id
      AND s.id=json_extract(expected.value,'$.id') AND s.name=json_extract(expected.value,'$.name')
      AND s.position=json_extract(expected.value,'$.position') AND s.deleted_at IS NULL))`)
    .bind(input.id, device.space_id, input.name, scopeId, ...authority.bindings, ...audience.bindings, device.id, input.sections.length, sections).first();
  if (!layout) throw new ApiError(409, "The import layout or your access changed. Refresh before starting a new import.");
  return Response.json({ album: layout, sections: input.sections });
}
