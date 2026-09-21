import { z } from "zod";
import { ApiError, database, readJson, requireOwner, type ActiveDevice } from "./server";
import type { AlbumSection } from "./contracts";
import { transferAuthority } from "./transfer-authority";

const revision = z.number().int().nonnegative();
const sectionName = z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f]/.test(value));
const albumGuard = "EXISTS (SELECT 1 FROM albums WHERE id = ? AND space_id = ? AND revision = ? AND deleted_at IS NULL AND archived_at IS NULL)";

// Reads and mutations share the album audience; section names never confer privacy.
export async function sectionAction(request: Request, device: ActiveDevice, id?: string) {
  if (id === "template" && request.method === "POST") return applySectionTemplate(request, device);
  if (id === "order" && request.method === "POST") return reorderSections(request, device);
  if (request.method === "GET") {
    const albumId = new URL(request.url).searchParams.get("album");
    const album = await database().prepare("SELECT revision FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL").bind(albumId, device.space_id).first();
    if (!album) throw new ApiError(404, "This album is not available.");
    const sections = await database().prepare(`SELECT s.id, s.album_id AS albumId, s.name, s.position,
      CASE WHEN EXISTS (SELECT 1 FROM album_media cover_membership JOIN media cover ON cover.id = cover_membership.media_id
        WHERE cover_membership.album_id = s.album_id AND cover_membership.section_id = s.id AND cover.id = s.cover_media_id
        AND cover.status = 'ready' AND cover.archived_at IS NULL AND cover.preview_ready = 1) THEN s.cover_media_id ELSE NULL END AS coverMediaId,
      COUNT(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN 1 END) AS count
      FROM album_sections s LEFT JOIN album_media am ON am.album_id = s.album_id AND am.section_id = s.id
      LEFT JOIN media m ON m.id = am.media_id WHERE s.album_id = ? AND s.deleted_at IS NULL
      GROUP BY s.id ORDER BY s.position, s.id`).bind(albumId).all<AlbumSection>();
    return Response.json({ sections: sections.results, revision: album.revision });
  }
  requireOwner(device);
  const input = await readJson(request, z.object({ albumId: z.string().uuid(), expectedRevision: revision, name: sectionName,
    position: z.number().int().min(-1000000).max(1000000).default(0), deleted: z.boolean().default(false), coverMediaId: z.string().uuid().nullable().optional() }));
  if (input.coverMediaId) {
    const cover = await database().prepare(`SELECT m.id FROM media m JOIN album_media am ON am.media_id = m.id
      WHERE am.album_id = ? AND am.section_id = ? AND m.id = ? AND m.space_id = ? AND m.status = 'ready'
      AND m.archived_at IS NULL AND m.preview_ready = 1`).bind(input.albumId, id || null, input.coverMediaId, device.space_id).first();
    if (!cover) throw new ApiError(409, "Choose a file with a preview in this section for its cover.");
  }
  const authority = transferAuthority(device, Date.now(), true);
  const liveAlbumGuard = `${albumGuard} AND ${authority.sql}`;
  const guardValues = [input.albumId, device.space_id, input.expectedRevision, ...authority.bindings];
  const sectionId = id || crypto.randomUUID();
  let statement;
  if (request.method === "POST" && !id) {
    statement = database().prepare(`INSERT INTO album_sections (album_id, id, name, position)
      SELECT ?, ?, ?, ? WHERE ${liveAlbumGuard}`).bind(input.albumId, sectionId, input.name, input.position, ...guardValues);
  } else if (request.method === "PUT" && id) {
    statement = database().prepare(`UPDATE album_sections SET name = ?, position = ?, deleted_at = ?, cover_media_id = CASE WHEN ? THEN ? ELSE cover_media_id END
      WHERE album_id = ? AND id = ? AND ${liveAlbumGuard}`).bind(input.name, input.position, input.deleted ? Date.now() : null, input.coverMediaId !== undefined ? 1 : 0, input.coverMediaId || null, input.albumId, id, ...guardValues);
  } else throw new ApiError(404, "This section action is unavailable.");
  try {
    const results = await database().batch([statement, database().prepare(`UPDATE albums SET revision = revision + 1
      WHERE id = ? AND space_id = ? AND revision = ? AND ${authority.sql} AND deleted_at IS NULL AND archived_at IS NULL AND changes() = 1`).bind(...guardValues)]);
    if (!results[0].meta.changes) throw new ApiError(409, "The album changed or is archived. Refresh before trying again.");
  } catch (error) {
    if (/UNIQUE constraint failed/.test(String(error))) throw new ApiError(409, "A section with this name already exists in this album.");
    throw error;
  }
  return Response.json({ id: sectionId, revision: input.expectedRevision + 1 });
}

// Reordering the complete active list keeps positions stable after repeated keyboard moves.
async function reorderSections(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ albumId: z.string().uuid(), expectedRevision: revision,
    ids: z.array(z.string().uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length) }));
  const json = JSON.stringify(input.ids);
  const authority = transferAuthority(device, Date.now(), true);
  const guard = `${albumGuard} AND (SELECT COUNT(*) FROM album_sections WHERE album_id = ? AND deleted_at IS NULL) = ?
    AND (SELECT COUNT(*) FROM album_sections WHERE album_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))) = ? AND ${authority.sql}`;
  const values = [input.albumId, device.space_id, input.expectedRevision, input.albumId, input.ids.length, input.albumId, json, input.ids.length, ...authority.bindings];
  const results = await database().batch([
    database().prepare(`UPDATE album_sections SET position = (SELECT CAST(key AS INTEGER) * 10 FROM json_each(?) WHERE value = album_sections.id)
      WHERE album_id = ? AND deleted_at IS NULL AND ${guard}`).bind(json, input.albumId, ...values),
    database().prepare(`UPDATE albums SET revision = revision + 1 WHERE id = ? AND ${guard}`).bind(input.albumId, ...values),
  ]);
  if (results[0].meta.changes !== input.ids.length) throw new ApiError(409, "Sections changed. Refresh before reordering.");
  return Response.json({ revision: input.expectedRevision + 1 });
}

// Template placement is limited to the exact previewed selection; future uploads are never reclassified.
async function applySectionTemplate(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ albumId: z.string().uuid(), expectedRevision: revision,
    files: z.array(z.object({ id: z.string().uuid(), expectedRevision: revision })).max(100)
      .refine(files => new Set(files.map(file => file.id)).size === files.length) }));
  const originalId = crypto.randomUUID(), finalId = crypto.randomUUID();
  const json = JSON.stringify(input.files);
  const selected = `(SELECT COUNT(*) FROM json_each(?) chosen JOIN media m ON m.id = json_extract(chosen.value, '$.id')
    JOIN album_media am ON am.media_id = m.id WHERE am.album_id = ? AND m.space_id = ? AND m.status = 'ready'
    AND m.archived_at IS NULL AND m.revision = json_extract(chosen.value, '$.expectedRevision')) = ?`;
  const selectionValues = [json, input.albumId, device.space_id, input.files.length];
  const created = "EXISTS (SELECT 1 FROM album_sections WHERE album_id = ? AND id = ?)";
  const createdValues = [input.albumId, originalId];
  const authority = transferAuthority(device, Date.now(), true);
  const results = await database().batch([
    database().prepare(`INSERT INTO album_sections (album_id, id, name, position) SELECT ?, ?, 'Originals', 10
      WHERE ${albumGuard} AND NOT EXISTS (SELECT 1 FROM album_sections WHERE album_id = ? AND deleted_at IS NULL)
      AND ${selected} AND ${authority.sql}`).bind(input.albumId, originalId, input.albumId, device.space_id, input.expectedRevision, input.albumId, ...selectionValues, ...authority.bindings),
    database().prepare(`INSERT INTO album_sections (album_id, id, name, position) SELECT ?, ?, 'Final cuts', 20 WHERE ${created}`).bind(input.albumId, finalId, ...createdValues),
    database().prepare(`UPDATE album_media SET section_id = CASE (SELECT category FROM media WHERE id = album_media.media_id) WHEN 'final' THEN ? ELSE ? END
      WHERE album_id = ? AND media_id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${created}`).bind(finalId, originalId, input.albumId, json, ...createdValues),
    database().prepare(`UPDATE media SET revision = revision + 1 WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${created}
      RETURNING id, revision`).bind(json, ...createdValues),
    database().prepare(`UPDATE albums SET revision = revision + 1 WHERE id = ? AND ${created}`).bind(input.albumId, ...createdValues),
  ]);
  if (!results[0].meta.changes) throw new ApiError(409, "The album or previewed files changed. Refresh the template preview.");
  return Response.json({ revision: input.expectedRevision + 1, files: results[3].results });
}

// A single transactional guard covers the entire selection, including all destinations and revisions.
export async function placeInSections(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ albumId: z.string().uuid(), files: z.array(z.object({
    id: z.string().uuid(), expectedRevision: revision, sectionId: z.string().uuid().nullable(),
  })).min(1).max(100).refine(files => new Set(files.map(file => file.id)).size === files.length) }));
  const json = JSON.stringify(input.files);
  const authority = transferAuthority(device, Date.now(), true);
  const guard = `(SELECT COUNT(*) FROM json_each(?) chosen JOIN media m ON m.id = json_extract(chosen.value, '$.id')
    JOIN album_media am ON am.media_id = m.id AND am.album_id = ? JOIN albums a ON a.id = am.album_id
    WHERE m.space_id = ? AND a.space_id = m.space_id AND a.deleted_at IS NULL AND a.archived_at IS NULL
    AND m.status = 'ready' AND m.archived_at IS NULL AND m.revision = json_extract(chosen.value, '$.expectedRevision')
    AND (json_extract(chosen.value, '$.sectionId') IS NULL OR EXISTS (SELECT 1 FROM album_sections s
      WHERE s.album_id = a.id AND s.id = json_extract(chosen.value, '$.sectionId') AND s.deleted_at IS NULL))) = ? AND ${authority.sql}`;
  const guardValues = [json, input.albumId, device.space_id, input.files.length, ...authority.bindings];
  const selectedIds = "SELECT json_extract(value, '$.id') FROM json_each(?)";
  const results = await database().batch([
    database().prepare(`SELECT am.media_id AS id, CASE WHEN s.deleted_at IS NULL THEN am.section_id ELSE NULL END AS sectionId,
      m.revision + 1 AS expectedRevision FROM album_media am JOIN media m ON m.id = am.media_id
      LEFT JOIN album_sections s ON s.album_id = am.album_id AND s.id = am.section_id
      WHERE am.album_id = ? AND am.media_id IN (${selectedIds}) AND ${guard}`).bind(input.albumId, json, ...guardValues),
    database().prepare(`UPDATE album_media SET section_id = (SELECT json_extract(value, '$.sectionId') FROM json_each(?)
      WHERE json_extract(value, '$.id') = album_media.media_id)
      WHERE album_id = ? AND media_id IN (${selectedIds}) AND ${guard}`).bind(json, input.albumId, json, ...guardValues),
    database().prepare(`UPDATE media SET revision = revision + 1 WHERE id IN (${selectedIds}) AND ${guard}
      RETURNING id, revision`).bind(json, ...guardValues),
  ]);
  if (results[2].results.length !== input.files.length) throw new ApiError(409, "The selection or destination changed. Refresh; no files were moved.");
  return Response.json({ previous: results[0].results, files: results[2].results });
}
