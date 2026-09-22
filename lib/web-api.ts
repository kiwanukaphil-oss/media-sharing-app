import { changePersonalFavorite } from "./personal-favorites";
import { exportSelectedMetadata } from "./metadata-export";
import { readLibraryActivity, activityBatch } from "./library-activity";
import { fileEditAuthority, requireFileEditor } from "./file-edit-authority";
import { z } from "zod";
import { libraryAction, requireAlbum } from "./library-api";
import { ApiError, bucket, database, requireMedia, requireOwner, requireOrganiser, spaceLimitBytes, type ActiveDevice, type UploadRow } from "./server";
import type { MediaItem } from "./contracts";
import { cancelPublication } from "./publications";
import { transferAuthority } from "./transfer-authority";

// Stable keyset pagination avoids duplicates when a new drop arrives between page requests.
export async function readFeed(request: Request, device: ActiveDevice) {
  const query = new URL(request.url).searchParams;
  const category = query.get("category") || "all";
  if (!["all", "original", "final", "trash"].includes(category)) throw new ApiError(400, "Unknown file category.");
  const search = (query.get("q") || "").trim().slice(0, 200);
  const limit = Math.min(100, Math.max(1, Number(query.get("limit") || 48)));
  if (!Number.isInteger(limit)) throw new ApiError(400, "Invalid page size.");
  const values: (string | number)[] = [device.space_id];
  let where = `media.space_id = ? AND media.status ${category === "trash" ? "IN ('ready', 'deleting')" : "= 'ready'"} AND media.archived_at IS ${category === "trash" ? "NOT " : ""}NULL`;
  if (category === "original" || category === "final") { where += " AND media.category = ?"; values.push(category); }
  const mediaType = query.get("type") || "";
  if (!["", "photo", "video", "other"].includes(mediaType)) throw new ApiError(400, "Choose a valid file type.");
  if (mediaType === "photo") where += " AND media.mime LIKE 'image/%'";
  if (mediaType === "video") where += " AND media.mime LIKE 'video/%'";
  if (mediaType === "other") where += " AND media.mime NOT LIKE 'image/%' AND media.mime NOT LIKE 'video/%'";
  const favoriteFilter = query.get("favorites") || "";
  if (!["", "1"].includes(favoriteFilter)) throw new ApiError(400, "Choose a valid favourites filter.");
  if (favoriteFilter) {
    if (device.authentication !== "account" || !device.personId) throw new ApiError(403, "Sign in to open private favourites.");
    where += " AND EXISTS (SELECT 1 FROM personal_favorites favorite WHERE favorite.media_id=media.id AND favorite.person_id=?)";
    values.push(device.personId);
  }
  const uploader = query.get("uploader") || "";
  if (!["", "me"].includes(uploader)) throw new ApiError(400, "Choose a valid uploader filter.");
  if (uploader === "me") {
    // Account ownership uses this exact membership's recorded actors, including explicitly claimed
    // legacy devices. A different browser name or a rejoined membership never inherits attribution.
    where += device.authentication === "account" ? ` AND (media.device_id = ? OR EXISTS (
      SELECT 1 FROM legacy_owner_claims claimed JOIN account_space_actors actor ON actor.membership_id=claimed.membership_id
      WHERE actor.device_id=? AND claimed.device_id=media.device_id))` : " AND media.device_id = ?";
    values.push(device.id);
    if (device.authentication === "account") values.push(device.id);
  }
  const album = query.get("album");
  if (album === "unorganised") where += " AND NOT EXISTS (SELECT 1 FROM album_media am JOIN albums a ON a.id = am.album_id WHERE am.media_id = media.id AND a.deleted_at IS NULL)";
  else if (album) { await requireAlbum(device, album); where += " AND EXISTS (SELECT 1 FROM album_media WHERE media_id = media.id AND album_id = ?)"; values.push(album); }
  const section = query.get("section");
  if (section) {
    if (!album || album === "unorganised") throw new ApiError(400, "Choose an album before a section.");
    if (section === "unsectioned") {
      where += " AND EXISTS (SELECT 1 FROM album_media am LEFT JOIN album_sections s ON s.album_id = am.album_id AND s.id = am.section_id WHERE am.media_id = media.id AND am.album_id = ? AND (am.section_id IS NULL OR s.deleted_at IS NOT NULL))";
      values.push(album);
    } else {
      const available = await database().prepare("SELECT id FROM album_sections WHERE album_id = ? AND id = ? AND deleted_at IS NULL").bind(album, section).first();
      if (!available) throw new ApiError(404, "This section is no longer available.");
      where += " AND EXISTS (SELECT 1 FROM album_media WHERE media_id = media.id AND album_id = ? AND section_id = ?)";
      values.push(album, section);
    }
  }
  if (search) { where += " AND (instr(lower(media.name), lower(?)) > 0 OR instr(lower(COALESCE(media.original_name, media.name)), lower(?)) > 0)"; values.push(search, search); }
  const dateMode = query.get("dateMode") || "uploaded";
  if (!["uploaded", "captured"].includes(dateMode)) throw new ApiError(400, "Unknown date mode.");
  const dateColumn = dateMode === "captured" ? "COALESCE(media.captured_at, strftime('%Y-%m-%dT%H:%M:%S', media.created_at / 1000, 'unixepoch'))" : "strftime('%Y-%m-%dT%H:%M:%S', media.created_at / 1000, 'unixepoch')";
  for (const [key, operator] of [["from", ">="], ["to", "<="]]) {
    const date = query.get(key);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date) throw new ApiError(400, "Choose a valid date.");
      where += ` AND substr(${dateColumn}, 1, 10) ${operator} ?`; values.push(date);
    }
  }
  if (query.get("from") && query.get("to") && query.get("from")! > query.get("to")!) throw new ApiError(400, "The start date must be before the end date.");
  const batch = query.get("batch");
  if (batch) { if (!z.string().uuid().safeParse(batch).success) throw new ApiError(400, "Invalid upload batch."); where += " AND media.upload_batch = ?"; values.push(batch); }
  const sort = query.get("sort") || "newest";
  if (!["newest", "oldest"].includes(sort)) throw new ApiError(400, "Unknown sort order.");
  const direction = sort === "oldest" ? "ASC" : "DESC";
  const comparison = sort === "oldest" ? ">" : "<";
  const sortColumn = dateMode === "captured" ? `COALESCE(CAST(strftime('%s', media.captured_at) AS INTEGER) * 1000, media.created_at)` : "media.created_at";
  const total = await database().prepare(`SELECT COUNT(*) AS count FROM media WHERE ${where}`).bind(...values).first<{ count: number }>();
  if (query.has("cursor")) {
    try {
      const cursor = z.object({ createdAt: z.number().int(), id: z.string().uuid() }).parse(JSON.parse(atob(query.get("cursor")!)));
      where += ` AND (${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND media.id ${comparison} ?))`;
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    } catch { throw new ApiError(400, "This page link is invalid. Refresh the feed."); }
  }
  const editable = fileEditAuthority(device);
  const result = await database().prepare(`SELECT EXISTS (SELECT 1 FROM personal_favorites favorite WHERE favorite.media_id=media.id AND favorite.person_id=?) AS isFavorite, (${editable.sql}) AS canEdit, media.id, media.name, media.mime, media.size, media.sha256, media.category,
    COALESCE(media.original_name, media.name) AS originalName, media.captured_at AS capturedAt, media.upload_batch AS uploadBatch, media.revision, ${sortColumn} AS sortValue, media.created_at AS createdAt, media.archived_at AS archivedAt, media.preview_ready AS hasPreview, devices.name AS deviceName
    FROM media JOIN devices ON devices.id = media.device_id WHERE ${where} ORDER BY ${sortColumn} ${direction}, media.id ${direction} LIMIT ?`).bind(device.authentication === "account" ? device.personId || "" : "", ...editable.bindings, ...values, limit + 1).all<MediaItem & { sortValue: number }>();
  const items = result.results.slice(0, limit);
  const last = items.at(-1);
  const counts = await database().prepare(`SELECT COUNT(CASE WHEN archived_at IS NULL THEN 1 END) AS "all",
    COUNT(CASE WHEN archived_at IS NULL AND category = 'original' THEN 1 END) AS original,
    COUNT(CASE WHEN archived_at IS NULL AND category = 'final' THEN 1 END) AS final,
    COUNT(CASE WHEN archived_at IS NOT NULL THEN 1 END) AS trash FROM media WHERE space_id = ? AND status IN ('ready','deleting')`).bind(device.space_id).first();
  return Response.json({ items, role: device.role, total: total?.count || 0, counts, nextCursor: result.results.length > limit && last ? btoa(JSON.stringify({ createdAt: last.sortValue, id: last.id })) : null });
}

export async function readStorage(device: ActiveDevice) {
  const usage = await database().prepare(`SELECT COALESCE(SUM(size + preview_size),0) AS used,
    COALESCE(SUM(CASE WHEN status IN ('uploading','cancelling','publishing') THEN size + preview_size ELSE 0 END),0) AS reserved,
    COALESCE(SUM(CASE WHEN archived_at IS NOT NULL THEN size + preview_size ELSE 0 END),0) AS trash FROM media WHERE space_id = ?`).bind(device.space_id).first();
  const uploads = await database().prepare(`SELECT media.id, media.name, media.size, media.created_at AS createdAt, devices.name AS deviceName,
    (? <> 'viewer' AND (media.device_id = ? OR ? = 'owner' OR (? = 1 AND ? = 'editor'))) AS canCancel, (media.status = 'publishing') AS publication
    FROM media JOIN devices ON devices.id = media.device_id WHERE media.space_id = ? AND media.status IN ('uploading','cancelling','publishing') ORDER BY media.created_at LIMIT 100`).bind(device.role, device.id, device.role, device.authentication === "account" ? 1 : 0, device.role, device.space_id).all();
  return Response.json({ ...usage, limit: spaceLimitBytes(device), uploads: uploads.results });
}

// Previews are small, separate JPEG objects. An original is never decoded or replaced here.
async function writeThumbnail(request: Request, device: ActiveDevice, id: string, storage: R2Bucket) {
  const item = await requireMedia(device, id, true);
  if (item.status !== "ready" || item.archived_at) throw new ApiError(409, "This original is not available for preview.");
  if (item.preview_ready) return Response.json({ ready: true });
  if (request.headers.get("Content-Type") !== "image/jpeg" || !request.body) throw new ApiError(415, "Use a JPEG preview.");
  if (Number(request.headers.get("Content-Length")) > 250000) throw new ApiError(413, "Preview is too large.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 250000) { reader.releaseLock(); throw new ApiError(413, "Preview is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (size < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[size - 2] !== 255 || bytes[size - 1] !== 217) throw new ApiError(415, "Invalid JPEG preview.");
  const authority = transferAuthority(device);
  const reserved = await database().prepare(`UPDATE media SET preview_size = ? WHERE id = ? AND status = 'ready' AND preview_ready = 0 AND preview_size = 0
    AND archived_at IS NULL AND ${authority.sql}
    AND (SELECT COALESCE(SUM(size + preview_size),0) FROM media WHERE space_id = ?) + ? <= ?`)
    .bind(size, id,...authority.bindings,device.space_id, size, spaceLimitBytes(device)).run();
  if (!reserved.meta.changes) return Response.json({ ready: false });
  try {
    await storage.put(`${item.object_key}.preview.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const current = transferAuthority(device);
    const committed = await database().prepare(`UPDATE media SET preview_ready = 1 WHERE id = ? AND status = 'ready'
      AND archived_at IS NULL AND ${current.sql}`).bind(id,...current.bindings).run();
    if (!committed.meta.changes) {
      await storage.delete(`${item.object_key}.preview.jpg`);
      throw new ApiError(409, "This preview could not be saved because the file or library access changed.");
    }
  } catch (failure) {
    await database().prepare("UPDATE media SET preview_size = 0 WHERE id = ? AND preview_ready = 0").bind(id).run(); throw failure;
  }
  return Response.json({ ready: true });
}

// A tombstone prevents new links during deletion; storage is released only after R2 acknowledges it.
async function permanentlyDelete(item: UploadRow, storage: R2Bucket, device: ActiveDevice) {
  if (!item.archived_at) throw new ApiError(409, "Move this file to Trash before deleting it permanently.");
  const authority = transferAuthority(device, Date.now(), true);
  const deleting = await database().prepare(`UPDATE media SET status = 'deleting' WHERE id = ?
    AND object_key = ? AND archived_at IS NOT NULL AND status IN ('ready','deleting') AND ${authority.sql}`)
    .bind(item.id, item.object_key, ...authority.bindings).run();
  if (!deleting.meta.changes) throw new ApiError(409, "The file or library access changed. Refresh before deleting.");
  await storage.delete([item.object_key, `${item.object_key}.preview.jpg`]);
  const completion = transferAuthority(device, Date.now(), true);
  const [removed] = await activityBatch(device, "file.delete", [{ kind: "media", id: item.id }], [database().prepare(`DELETE FROM media WHERE id = ? AND status = 'deleting' AND ${completion.sql}`)
    .bind(item.id, ...completion.bindings)]);
  if (!removed.meta.changes) throw new ApiError(409, "Access changed during cleanup. Refresh to review the remaining record.");
  return Response.json({ deleted: true });
}

// All management actions inherit the route's CSRF check and scope every object to the paired space.
export async function webAction(request: Request, device: ActiveDevice, resource: string, id?: string, action?: string, storage: R2Bucket = bucket()): Promise<Response | null> {
  const method = request.method;
  if (resource === "metadata-export" && !id && method === "POST") return exportSelectedMetadata(request, device);
  if (resource === "activity" && !id && method === "GET") return readLibraryActivity(request, device);
  if (resource === "favorites" && id && !action && method === "PUT") return changePersonalFavorite(request, device, id);
  const libraryResponse = await libraryAction(request, device, resource, id);
  if (libraryResponse) return libraryResponse;
  if (resource === "feed" && method === "GET") return readFeed(request, device);
  if (resource === "storage" && method === "GET") return readStorage(device);
  if (resource === "media" && id && action === "thumbnail" && method === "PUT") return writeThumbnail(request, device, id, storage);
  if (resource === "media" && id && action === "thumbnail" && method === "GET") {
    const item = await requireMedia(device, id);
    if (item.status !== "ready" || !item.preview_ready) throw new ApiError(404, "No preview is available.");
    const object = await storage.get(`${item.object_key}.preview.jpg`);
    if (!object) throw new ApiError(404, "No preview is available.");
    return new Response(object.body, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(object.size) } });
  }
  if (resource === "media" && id && (action === "archive" || action === "restore") && method === "POST") {
    requireFileEditor(device);
    const item = await requireMedia(device, id);
    if (item.status !== "ready") throw new ApiError(409, "This transfer is not ready.");
    const authority = fileEditAuthority(device);
    const [changed] = await activityBatch(device, action === "archive" ? "file.trash" : "file.restore", [{ kind: "media", id, revision: item.revision + 1 }], [database().prepare(`UPDATE media SET archived_at = ?, revision = revision + 1 WHERE id = ? AND status = 'ready' AND revision = ? AND ${authority.sql}`)
      .bind(action === "archive" ? Date.now() : null, id, item.revision, ...authority.bindings)]);
    if (!changed.meta.changes) throw new ApiError(409, "The file or library access changed. Refresh before trying again.");
    return Response.json({ changed: true });
  }
  if (resource === "media" && id && !action && method === "DELETE") {
    requireOwner(device);
    return permanentlyDelete(await requireMedia(device, id), storage, device);
  }
  if (resource === "uploads" && id && !action && method === "DELETE") {
    const item = await requireMedia(device, id);
    if (item.device_id !== device.id) requireOrganiser(device);
    if (item.status === "publishing" || (item.status === "cancelling" && await database().prepare("SELECT id FROM publications WHERE id = ?").bind(id).first())) {
      const publisher = await database().prepare("SELECT person_id FROM space_memberships WHERE id = ?").bind(device.id).first<{ person_id: string }>();
      return Response.json(await cancelPublication(database(), storage, { ...device, personId: device.authentication === "account" ? publisher?.person_id : undefined }, id));
    }
    if (!["uploading", "cancelling"].includes(item.status)) throw new ApiError(409, "This file has already arrived. Refresh your feed.");
    const authority = transferAuthority(device, Date.now(), item.device_id !== device.id ? "organiser" : false);
    const cancelled = await database().prepare(`UPDATE media SET status = 'cancelling' WHERE id = ?
      AND upload_id = ? AND status IN ('uploading','cancelling') AND ${authority.sql}`)
      .bind(id, item.upload_id, ...authority.bindings).run();
    if (!cancelled.meta.changes) throw new ApiError(409, "The transfer or library access changed. Refresh before cancelling.");
    try { await storage.resumeMultipartUpload(item.object_key, item.upload_id).abort(); }
    catch (failure) { if (!/NoSuchUpload|does not exist|not found/i.test(String(failure))) throw failure; }
    await storage.delete(item.object_key);
    const completion = transferAuthority(device, Date.now(), item.device_id !== device.id ? "organiser" : false);
    const removed = await database().prepare(`DELETE FROM media WHERE id = ? AND status = 'cancelling' AND upload_id = ? AND ${completion.sql}`)
      .bind(id, item.upload_id, ...completion.bindings).run();
    if (!removed.meta.changes) throw new ApiError(409, "Access changed during cancellation. Refresh to review the remaining transfer.");
    return Response.json({ cancelled: true });
  }
  if (resource === "uploads" && id && action === "restart" && method === "POST") {
    const item = await requireMedia(device, id, true);
    if (item.status !== "uploading") throw new ApiError(409, "Only unfinished uploads can be restarted.");
    const upload = await storage.createMultipartUpload(item.object_key, { httpMetadata: { contentType: item.mime }, customMetadata: { sha256: item.sha256, filename: item.name } });
    const authority = transferAuthority(device);
    const changed = await database().prepare(`UPDATE media SET upload_id = ? WHERE id = ? AND upload_id = ? AND status = 'uploading' AND ${authority.sql}`)
      .bind(upload.uploadId, id, item.upload_id, ...authority.bindings).run();
    if (!changed.meta.changes) { await upload.abort(); throw new ApiError(409, "This transfer changed. Refresh and retry."); }
    try { await storage.resumeMultipartUpload(item.object_key, item.upload_id).abort(); } catch { /* Expired upload parts may already have been removed by R2. */ }
    return Response.json({ id, partSize: item.part_size, status: "uploading", uploadId: upload.uploadId });
  }
  return null;
}
