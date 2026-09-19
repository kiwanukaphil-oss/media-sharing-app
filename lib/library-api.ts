import { z } from "zod";
import { ApiError, database, readJson, requireOwner, type ActiveDevice } from "./server";
import { splitFilename, validCaptureDate, validFilename } from "./library-names";
import type { Album } from "./contracts";
import { sectionAction, placeInSections } from "./sections-api";

const albumFields = { name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).default("") };
const selectionSchema = z.array(z.object({ id: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), sectionId: z.string().uuid().nullable().optional() })).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length);

export async function requireAlbum(device: ActiveDevice, id: string, active = false) {
  const album = await database().prepare("SELECT * FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL").bind(id, device.space_id).first<{ id: string; archived_at: number | null }>();
  if (!album) throw new ApiError(404, "This album is not available.");
  if (active && album.archived_at) throw new ApiError(409, "Unarchive this album before adding files.");
  return album;
}

// JSON selection parameters keep bulk requests bounded and protect the entire selection against stale edits.
function selectionGuard(state: "any" | "active" | "trashed" = "any") {
  return `(SELECT COUNT(*) FROM media AS candidate JOIN json_each(?) AS chosen ON candidate.id = json_extract(chosen.value, '$.id')
    WHERE candidate.space_id = ? AND candidate.status = 'ready' ${state === "active" ? "AND candidate.archived_at IS NULL" : state === "trashed" ? "AND candidate.archived_at IS NOT NULL" : ""} AND candidate.revision = json_extract(chosen.value, '$.expectedRevision')) = ?`;
}

// Album deletion hides its grouping only; retained memberships make explicit restoration lossless.
async function manageAlbums(request: Request, device: ActiveDevice, id?: string) {
  if (request.method === "GET" && !id) {
    const albums = await database().prepare(`SELECT a.id, a.name, a.description, a.created_at AS createdAt, a.archived_at AS archivedAt,
      a.deleted_at AS deletedAt, a.revision, COUNT(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN 1 END) AS count
      FROM albums a LEFT JOIN album_media am ON am.album_id = a.id LEFT JOIN media m ON m.id = am.media_id
      WHERE a.space_id = ? AND a.deleted_at IS NULL GROUP BY a.id ORDER BY a.archived_at IS NOT NULL, a.name COLLATE NOCASE, a.id`).bind(device.space_id).all<Album>();
    const sections = await database().prepare(`SELECT s.id, s.album_id AS albumId, s.name, s.position,
      CASE WHEN EXISTS (SELECT 1 FROM album_media cover_membership JOIN media cover ON cover.id = cover_membership.media_id
        WHERE cover_membership.album_id = s.album_id AND cover_membership.section_id = s.id AND cover.id = s.cover_media_id
        AND cover.status = 'ready' AND cover.archived_at IS NULL AND cover.preview_ready = 1) THEN s.cover_media_id ELSE NULL END AS coverMediaId,
      COUNT(CASE WHEN m.status = 'ready' AND m.archived_at IS NULL THEN 1 END) AS count
      FROM album_sections s JOIN albums a ON a.id = s.album_id
      LEFT JOIN album_media am ON am.album_id = s.album_id AND am.section_id = s.id LEFT JOIN media m ON m.id = am.media_id
      WHERE a.space_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL GROUP BY s.album_id, s.id ORDER BY s.position, s.id`).bind(device.space_id).all();
    return Response.json({ albums: albums.results, sections: sections.results });
  }
  requireOwner(device);
  if (request.method === "POST" && !id) {
    const input = await readJson(request, z.object(albumFields));
    const albumId = crypto.randomUUID();
    await database().prepare("INSERT INTO albums (id, space_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)").bind(albumId, device.space_id, input.name, input.description, Date.now()).run();
    return Response.json({ id: albumId });
  }
  if (request.method === "PUT" && id) {
    const input = await readJson(request, z.object({ ...albumFields, expectedRevision: z.number().int().nonnegative(), archived: z.boolean(), deleted: z.boolean() }));
    const result = await database().prepare(`UPDATE albums SET name = ?, description = ?, archived_at = ?, deleted_at = ?, revision = revision + 1
      WHERE id = ? AND space_id = ? AND revision = ?`).bind(input.name, input.description, input.archived ? Date.now() : null, input.deleted ? Date.now() : null, id, device.space_id, input.expectedRevision).run();
    if (!result.meta.changes) throw new ApiError(409, "This album changed. Refresh before trying again.");
    return Response.json({ changed: true, revision: input.expectedRevision + 1 });
  }
  throw new ApiError(404, "This album action is not available.");
}

// Renames are one conditional SQL update: stale selections never produce a partially renamed batch.
async function renameFiles(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ files: z.array(z.object({ id: z.string().uuid(), name: z.string().refine(validFilename), expectedRevision: z.number().int().nonnegative() })).min(1).max(100) }));
  if (new Set(input.files.map(file => file.id)).size !== input.files.length) throw new ApiError(400, "Select each file once.");
  const json = JSON.stringify(input.files);
  const existing = await database().prepare(`SELECT id, name FROM media WHERE space_id = ? AND status = 'ready' AND archived_at IS NULL
    AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`).bind(device.space_id, json).all<{ id: string; name: string }>();
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
  const result = await database().prepare(`UPDATE media SET original_name = COALESCE(original_name, name),
    name = (SELECT json_extract(value, '$.name') FROM json_each(?) WHERE json_extract(value, '$.id') = media.id), revision = revision + 1
    WHERE space_id = ? AND archived_at IS NULL AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${selectionGuard("active")}
    AND NOT EXISTS (${conflictsQuery})
    RETURNING id, name, revision`).bind(json, device.space_id, json, json, device.space_id, input.files.length, json, json).all();
  if (result.results.length !== input.files.length) throw new ApiError(409, "A file or filename changed. Refresh before renaming; no files were renamed.");
  return Response.json({ files: result.results });
}

// Membership and trash edits use the same optimistic revision guard within one D1 transaction.
async function organiseFiles(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ files: selectionSchema, action: z.enum(["add", "remove", "trash", "restore"]), albumId: z.string().uuid().optional() }));
  const json = JSON.stringify(input.files);
  let selected = `media.space_id = ? AND media.status = 'ready' AND media.id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND ${selectionGuard(input.action === "restore" ? "trashed" : input.action === "remove" ? "any" : "active")}`;
  const selectionValues: (string | number)[] = [device.space_id, json, json, device.space_id, input.files.length];
  if (input.action === "add" || input.action === "remove") {
    if (!input.albumId) throw new ApiError(400, "Choose an album.");
    await requireAlbum(device, input.albumId, input.action === "add");
    selected += ` AND EXISTS (SELECT 1 FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL ${input.action === "add" ? "AND archived_at IS NULL" : ""})`;
    selectionValues.push(input.albumId, device.space_id);
    if (input.action === "add") {
      selected += ` AND NOT EXISTS (SELECT 1 FROM json_each(?) chosen WHERE json_extract(chosen.value, '$.sectionId') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM album_sections s WHERE s.album_id = ? AND s.id = json_extract(chosen.value, '$.sectionId') AND s.deleted_at IS NULL))`;
      selectionValues.push(json, input.albumId);
    }
    const statement = input.action === "add"
      ? database().prepare(`INSERT OR IGNORE INTO album_media (album_id, media_id, section_id) SELECT ?, media.id, (SELECT json_extract(value, '$.sectionId') FROM json_each(?) WHERE json_extract(value, '$.id') = media.id) FROM media WHERE ${selected} RETURNING media_id AS id, section_id AS sectionId`).bind(input.albumId, json, ...selectionValues)
      : database().prepare(`DELETE FROM album_media WHERE album_id = ? AND media_id IN (SELECT media.id FROM media WHERE ${selected}) RETURNING media_id AS id, section_id AS sectionId`).bind(input.albumId, ...selectionValues);
    const results = await database().batch([
      statement,
      database().prepare(`UPDATE media SET revision = revision + 1 WHERE ${selected} RETURNING id, revision`).bind(...selectionValues),
    ]);
    if (results[1].results.length !== input.files.length) throw new ApiError(409, "The selection changed. Refresh and try again.");
    return Response.json({ changed: results[0].results, files: results[1].results });
  }
  const result = await database().prepare(`UPDATE media SET archived_at = ?, revision = revision + 1 WHERE ${selected} RETURNING id, revision`).bind(input.action === "trash" ? Date.now() : null, ...selectionValues).all();
  if (result.results.length !== input.files.length) throw new ApiError(409, "The selection changed. Refresh and try again.");
  return Response.json({ changed: result.results, files: result.results });
}

// Capture-date corrections are metadata-only and reject stale writes from another browser.
async function changeCaptureDate(request: Request, device: ActiveDevice) {
  requireOwner(device);
  const input = await readJson(request, z.object({ id: z.string().uuid(), capturedAt: z.string().refine(validCaptureDate).nullable(), expectedRevision: z.number().int().nonnegative() }));
  const result = await database().prepare("UPDATE media SET captured_at = ?, revision = revision + 1 WHERE id = ? AND space_id = ? AND status = 'ready' AND revision = ?").bind(input.capturedAt, input.id, device.space_id, input.expectedRevision).run();
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
