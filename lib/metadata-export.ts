import { resourceAudienceAuthority } from "./asset-scope-authority";
import { z } from "zod";
import { ApiError, database, readJson, type ActiveDevice } from "./server";
import { transferAuthority } from "./transfer-authority";

import {portableFilePath} from "./portable-file-path";
export {portableFilePath} from "./portable-file-path";

// Read the entire bounded selection in one D1 snapshot. Each query has the same all-or-nothing
// revision/current-authority guard: stale or foreign files never yield a partial export or counts.
export async function exportSelectedMetadata(request: Request, device: ActiveDevice) {
  const { files } = await readJson(request, z.object({ files: z.array(z.object({ id: z.string().uuid(), expectedRevision: z.number().int().nonnegative() }))
    .min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length) }));
  const selection = JSON.stringify(files), authority = transferAuthority(device, Date.now(), "read");
  const audience = resourceAudienceAuthority(device, "m");
  const guard = `(SELECT COUNT(*) FROM media m JOIN json_each(?) chosen ON m.id=json_extract(chosen.value,'$.id')
    WHERE m.space_id=? AND m.status='ready' AND m.revision=json_extract(chosen.value,'$.expectedRevision') AND ${audience.sql})=? AND ${authority.sql}`;
  const values = [selection, device.space_id, ...audience.bindings, files.length, ...authority.bindings];
  const selected = "SELECT json_extract(value,'$.id') FROM json_each(?)";
  const results = await database().batch<Record<string, string | number | null>>([
    database().prepare(`SELECT id,name,COALESCE(original_name,name) AS originalName,mime,size,sha256,captured_at AS capturedAt,
      created_at AS uploadedAt,archived_at AS trashedAt,revision FROM media WHERE space_id=? AND id IN (${selected}) AND ${guard} ORDER BY id`)
      .bind(device.space_id, selection, ...values),
    database().prepare(`SELECT am.media_id AS fileId,a.id AS albumId,a.name AS albumName,a.description AS albumDescription,a.revision AS albumRevision,
      a.archived_at AS albumArchivedAt,s.id AS sectionId,s.name AS sectionName,s.position AS sectionPosition
      FROM album_media am JOIN albums a ON a.id=am.album_id LEFT JOIN album_sections s ON s.album_id=a.id AND s.id=am.section_id AND s.deleted_at IS NULL
      WHERE a.space_id=? AND a.deleted_at IS NULL AND am.media_id IN (${selected}) AND ${guard} ORDER BY a.id,am.media_id LIMIT 2001`)
      .bind(device.space_id, selection, ...values),
    database().prepare(`SELECT s.id,s.name,CASE WHEN ps.space_id IS NULL THEN 'shared' ELSE 'personal' END AS kind
      FROM spaces s LEFT JOIN personal_spaces ps ON ps.space_id=s.id WHERE s.id=? AND ${guard}`).bind(device.space_id, ...values),
  ]);
  if (results[0].results.length !== files.length || results[2].results.length !== 1) throw new ApiError(409, "A selected file or your access changed. Refresh and select the files again.");
  if (results[1].results.length > 2000) throw new ApiError(413, "This selection has too many album references. Export a smaller selection.");
  const manifest = { format: "relay-metadata", formatVersion: 1, exportedAt: new Date().toISOString(), scope: results[2].results[0],
    includesOriginalBytes: false, checksumProvenance: "SHA-256 recorded at upload; verify downloaded bytes independently.",
    files: results[0].results.map(file => ({ ...file, suggestedPath: portableFilePath(String(file.id), String(file.name)),
      albums: results[1].results.filter(row => row.fileId === file.id).map(row => ({ id: row.albumId, name: row.albumName,
        description: row.albumDescription, revision: row.albumRevision, archivedAt: row.albumArchivedAt,
        section: row.sectionId ? { id: row.sectionId, name: row.sectionName, position: row.sectionPosition } : null })),
      // Version/companion relationships do not exist yet; do not infer them from matching names.
      relationships: [] })),
    privacy: "Contains filenames and organisation metadata. Original downloads may also contain EXIF/location data; this export does not sanitise originals." };
  return Response.json(manifest);
}
