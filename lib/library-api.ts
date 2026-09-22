import { resourceAudienceAuthority, browseAudienceAuthority, requestedBrowseAudience } from "./asset-scope-authority";
import { activityBatch, fileActivityResources } from "./library-activity";
import { activityStatement } from "./library-activity-statements";
import { fileEditAuthority, requireFileEditor } from "./file-edit-authority";
import { z } from "zod";
import { ApiError, database, readJson, requireOrganiser, type ActiveDevice } from "./server";
import { splitFilename, validCaptureDate, validFilename } from "./library-names";
import type { Album } from "./contracts";
import { sectionAction, placeInSections } from "./sections-api";
import { transferAuthority } from "./transfer-authority";

const albumFields = { name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).default("") };
const selectionSchema = z.array(z.object({ id: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), sectionId: z.string().uuid().nullable().optional() })).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length);

export async function requireAlbum(device: ActiveDevice, id: string, active = false) {
  const audience = resourceAudienceAuthority(device, "albums");
  const album = await database().prepare(`SELECT * FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND ${audience.sql}`).bind(id, device.space_id, ...audience.bindings).first<{ id: string; archived_at: number | null; access_scope_id: string | null }>();
  if (!album) throw new ApiError(404, "This album is not available.");
  if (active && album.archived_at) throw new ApiError(409, "Unarchive this album before adding files.");
  return album;
}

// JSON selection parameters keep bulk requests bounded and protect the entire selection against stale edits.
function selectionGuard(state: "any" | "active" | "trashed" = "any", editable = "1") {
  return `(SELECT COUNT(*) FROM media AS candidate JOIN json_each(?) AS chosen ON candidate.id = json_extract(chosen.value, '$.id')
    WHERE candidate.space_id = ? AND candidate.status = 'ready' ${state === "active" ? "AND candidate.archived_at IS NULL" : state === "trashed" ? "AND candidate.archived_at IS NOT NULL" : ""} AND candidate.revision = json_extract(chosen.value, '$.expectedRevision') AND ${editable}) = ?`;
}

// Album deletion hides its grouping only; retained memberships make explicit restoration lossless.
async function manageAlbums(request: Request, device: ActiveDevice, id?: string) {
  if (request.method === "GET" && !id) {
    const scope = requestedBrowseAudience(request, device);
    if (scope === false) throw new ApiError(400, "Choose a valid library audience.");
    const audience = browseAudienceAuthority(device, scope, "a");
    const albums = await database().prepare(`SELECT a.id, a.name, a.description, a.created_at AS createdAt, a.archived_at AS archivedAt,
      a.deleted_at AS deletedAt, a.revision, COUNT(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN 1 END) AS count,
      MAX(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN MAX(m.created_at,a.created_at) ELSE a.created_at END) AS latestUploadAt
      FROM albums a LEFT JOIN album_media am ON am.album_id = a.id LEFT JOIN media m ON m.id = am.media_id
      WHERE a.space_id = ? AND ${audience.sql} AND a.deleted_at IS NULL GROUP BY a.id ORDER BY a.archived_at IS NOT NULL, a.name COLLATE NOCASE, a.id`).bind(device.space_id, ...audience.bindings).all<Album>();
    const sections = await database().prepare(`SELECT s.id, s.album_id AS albumId, s.name, s.position,
      CASE WHEN EXISTS (SELECT 1 FROM album_media cover_membership JOIN media cover ON cover.id = cover_membership.media_id
        WHERE cover_membership.album_id = s.album_id AND cover_membership.section_id = s.id AND cover.id = s.cover_media_id
        AND cover.status = 'ready' AND cover.archived_at IS NULL AND cover.preview_ready = 1) THEN s.cover_media_id ELSE NULL END AS coverMediaId,
      COUNT(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN 1 END) AS count
      FROM album_sections s JOIN albums a ON a.id = s.album_id
      LEFT JOIN album_media am ON am.album_id = s.album_id AND am.section_id = s.id LEFT JOIN media m ON m.id = am.media_id
      WHERE a.space_id = ? AND ${audience.sql} AND a.deleted_at IS NULL AND s.deleted_at IS NULL GROUP BY s.album_id, s.id ORDER BY s.position, s.id`).bind(device.space_id, ...audience.bindings).all();
    return Response.json({ albums: albums.results, sections: sections.results });
  }
  requireOrganiser(device);
  if (request.method === "POST" && !id) {
    const input = await readJson(request, z.object(albumFields));
    const albumId = crypto.randomUUID();
    const authority = transferAuthority(device, Date.now(), "organiser");
    const [inserted] = await activityBatch(device, "album.create", [{ kind: "album", id: albumId, revision: 0 }], [database().prepare(`INSERT INTO albums (id, space_id, name, description, created_at) SELECT ?, ?, ?, ?, ? WHERE ${authority.sql}`)
      .bind(albumId, device.space_id, input.name, input.description, Date.now(), ...authority.bindings)]);
    if (!inserted.meta.changes) throw new ApiError(409, "Library access changed. Refresh before creating an album.");
    return Response.json({ id: albumId });
  }
  if (request.method === "PUT" && id) {
    const input = await readJson(request, z.object({ ...albumFields, expectedRevision: z.number().int().nonnegative(), archived: z.boolean(), deleted: z.boolean() }));
    const authority = transferAuthority(device, Date.now(), "organiser");
    const audience = resourceAudienceAuthority(device, "albums");
    const [result] = await activityBatch(device, input.deleted ? "album.remove" : input.archived ? "album.archive" : "album.update", [{ kind: "album", id, revision: input.expectedRevision + 1 }], [database().prepare(`UPDATE albums SET name = ?, description = ?, archived_at = ?, deleted_at = ?, revision = revision + 1
      WHERE id = ? AND space_id = ? AND revision = ? AND ${authority.sql} AND ${audience.sql}`).bind(input.name, input.description, input.archived ? Date.now() : null, input.deleted ? Date.now() : null, id, device.space_id, input.expectedRevision, ...authority.bindings, ...audience.bindings)]);
    if (!result.meta.changes) throw new ApiError(409, "This album changed. Refresh before trying again.");
    return Response.json({ changed: true, revision: input.expectedRevision + 1 });
  }
  throw new ApiError(404, "This album action is not available.");
}

// Renames are one conditional SQL update: stale selections never produce a partially renamed batch.
async function renameFiles(request: Request, device: ActiveDevice) {
  requireFileEditor(device);
  const input = await readJson(request, z.object({ files: z.array(z.object({ id: z.string().uuid(), name: z.string().refine(validFilename), expectedRevision: z.number().int().nonnegative() })).min(1).max(100) }));
  if (new Set(input.files.map(file => file.id)).size !== input.files.length) throw new ApiError(400, "Select each file once.");
  const json = JSON.stringify(input.files);
  const audience = resourceAudienceAuthority(device);
  const existing = await database().prepare(`SELECT id, name FROM media WHERE space_id = ? AND status = 'ready' AND archived_at IS NULL
    AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${audience.sql}`).bind(device.space_id, json, ...audience.bindings).all<{ id: string; name: string }>();
  if (existing.results.length !== input.files.length) throw new ApiError(409, "Some selected files are no longer available. Refresh the library.");
  for (const file of input.files) {
    if (splitFilename(file.name).extension !== splitFilename(existing.results.find(row => row.id === file.id)!.name).extension) throw new ApiError(400, "Keep the original file extension.");
  }
  // Names may repeat in unrelated albums, but not within any album shared by these files.
  const conflictsQuery = `SELECT 1 FROM json_each(?) proposed JOIN album_media own ON own.media_id = json_extract(proposed.value, '$.id')
    JOIN albums a ON a.id = own.album_id AND a.deleted_at IS NULL JOIN album_media other ON other.album_id = own.album_id AND other.media_id != own.media_id
    JOIN media m ON m.id = other.media_id AND m.status = 'ready' AND m.archived_at IS NULL
    LEFT JOIN json_each(?) sibling ON json_extract(sibling.value, '$.id') = m.id
    WHERE lower(COALESCE(json_extract(sibling.value, '$.name'), m.name)) = lower(json_extract(proposed.value, '$.name')) LIMIT 1`;
  const conflicts = await database().prepare(conflictsQuery).bind(json, json).first();
  if (conflicts) throw new ApiError(409, "A filename already exists in one of these albums. Choose another name or a different starting number.");
  const authority = fileEditAuthority(device, "candidate");
  const [result] = await activityBatch(device, "file.rename", fileActivityResources(input.files), [database().prepare(`UPDATE media SET original_name = COALESCE(original_name, name),
    name = (SELECT json_extract(value, '$.name') FROM json_each(?) WHERE json_extract(value, '$.id') = media.id), revision = revision + 1
    WHERE space_id = ? AND archived_at IS NULL AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${selectionGuard("active", authority.sql)}
    AND NOT EXISTS (${conflictsQuery})
    RETURNING id, name, revision`).bind(json, device.space_id, json, json, device.space_id, ...authority.bindings, input.files.length, json, json)]);
  if (result.results.length !== input.files.length) throw new ApiError(409, "A file or filename changed. Refresh before renaming; no files were renamed.");
  return Response.json({ files: result.results });
}

// Membership and trash edits use the same optimistic revision guard within one D1 transaction.
async function organiseFiles(request: Request, device: ActiveDevice) {
  requireFileEditor(device);
  const input = await readJson(request, z.object({ files: selectionSchema, action: z.enum(["add", "remove", "trash", "restore"]), albumId: z.string().uuid().optional() }));
  const json = JSON.stringify(input.files);
  const authority = fileEditAuthority(device, "candidate");
  let selected = `media.space_id = ? AND media.status = 'ready' AND media.id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${selectionGuard(input.action === "restore" ? "trashed" : input.action === "remove" ? "any" : "active", authority.sql)}`;
  const selectionValues: (string | number)[] = [device.space_id, json, json, device.space_id, ...authority.bindings, input.files.length];
  if (input.action === "add" || input.action === "remove") {
    if (!input.albumId) throw new ApiError(400, "Choose an album.");
    await requireAlbum(device, input.albumId, input.action === "add");
    const albumAudience = resourceAudienceAuthority(device, "albums");
    selected += ` AND EXISTS (SELECT 1 FROM albums WHERE id = ? AND space_id = ? AND ${albumAudience.sql} AND albums.access_scope_id IS media.access_scope_id AND deleted_at IS NULL ${input.action === "add" ? "AND archived_at IS NULL" : ""})`;
    selectionValues.push(input.albumId, device.space_id, ...albumAudience.bindings);
    if (input.action === "add") {
      selected += ` AND NOT EXISTS (SELECT 1 FROM json_each(?) chosen WHERE json_extract(chosen.value, '$.sectionId') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM album_sections s WHERE s.album_id = ? AND s.id = json_extract(chosen.value, '$.sectionId') AND s.deleted_at IS NULL))`;
      selectionValues.push(json, input.albumId);
    }
    const statement = input.action === "add"
      ? database().prepare(`INSERT OR IGNORE INTO album_media (album_id, media_id, section_id) SELECT ?, media.id, (SELECT json_extract(value, '$.sectionId') FROM json_each(?) WHERE json_extract(value, '$.id') = media.id) FROM media WHERE ${selected} RETURNING media_id AS id, section_id AS sectionId`).bind(input.albumId, json, ...selectionValues)
      : database().prepare(`DELETE FROM album_media WHERE album_id = ? AND media_id IN (SELECT media.id FROM media WHERE ${selected}) RETURNING media_id AS id, section_id AS sectionId`).bind(input.albumId, ...selectionValues);
    // Record actual membership changes before the selection's revisions advance. An already-present
    // reference is a successful no-op, not a new addition in the durable history.
    const results = await database().batch([
      statement,
      activityStatement(database(), device, input.action === "add" ? "file.add" : "file.remove", [...fileActivityResources(input.files), { kind: "album", id: input.albumId }]),
      database().prepare(`UPDATE media SET revision = revision + 1 WHERE ${selected} RETURNING id, revision`).bind(...selectionValues),
    ]);
    if (results[2].results.length !== input.files.length) throw new ApiError(409, "The selection changed. Refresh and try again.");
    return Response.json({ changed: results[0].results, files: results[2].results });
  }
  const [result] = await activityBatch(device, input.action === "trash" ? "file.trash" : "file.restore", fileActivityResources(input.files), [database().prepare(`UPDATE media SET archived_at = ?, revision = revision + 1 WHERE ${selected} RETURNING id, revision`).bind(input.action === "trash" ? Date.now() : null, ...selectionValues)]);
  if (result.results.length !== input.files.length) throw new ApiError(409, "The selection changed. Refresh and try again.");
  return Response.json({ changed: result.results, files: result.results });
}

// Capture-date corrections are metadata-only and reject stale writes from another browser.
async function changeCaptureDate(request: Request, device: ActiveDevice) {
  requireFileEditor(device);
  const input = await readJson(request, z.object({ id: z.string().uuid(), capturedAt: z.string().refine(validCaptureDate).nullable(), expectedRevision: z.number().int().nonnegative() }));
  const authority = fileEditAuthority(device);
  const [result] = await activityBatch(device, "file.date", fileActivityResources([input]), [database().prepare(`UPDATE media SET captured_at = ?, revision = revision + 1 WHERE id = ? AND space_id = ? AND status = 'ready' AND revision = ? AND ${authority.sql}`)
    .bind(input.capturedAt, input.id, device.space_id, input.expectedRevision, ...authority.bindings)]);
  if (!result.meta.changes) throw new ApiError(409, "This file changed. Refresh before correcting its date.");
  return Response.json({ revision: input.expectedRevision + 1 });
}

export async function libraryAction(request: Request, device: ActiveDevice, resource: string, id?: string) {
  if (resource === "sections") return sectionAction(request, device, id);
  if (resource === "library" && id === "sections" && request.method === "POST") return placeInSections(request, device);
  if (resource === "albums") return manageAlbums(request, device, id);
  if (resource !== "library" || request.method !== "POST") return null;
  if (id === "rename") return renameFiles(request, device);
  if (id === "organise") return organiseFiles(request, device);
  if (id === "capture-date") return changeCaptureDate(request, device);
  return null;
}
