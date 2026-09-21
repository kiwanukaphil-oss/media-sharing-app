import { AccountError } from "./account-sessions";
import type { AccountSpaceAccess } from "./account-space-access";
import type { ActiveDevice } from "./server";

export const MAX_PUBLICATION_BYTES = 1024 * 1024 * 1024;
type PublicationInput = { id: string; sourceId: string; sourceRevision: number; destinationSpaceId: string; albumId?: string; sectionId?: string };
type PublicationRow = { id: string; source_id: string; source_space_id: string; destination_space_id: string; person_id: string;
  source_revision: number; album_id: string | null; section_id: string | null; phase: string; attempt_key: string | null; lease_expires_at: number };
type OriginalRow = { id: string; name: string; mime: string; size: number; sha256: string; object_key: string; preview_ready: number; preview_size: number; revision: number };

// This first publication boundary is strictly personal-owner to an authorised shared-space membership.
const publicationAuthority = `EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id = a.person_id
  JOIN space_memberships own ON own.person_id = p.id JOIN personal_spaces ps ON ps.space_id = own.space_id AND ps.person_id = p.id
  JOIN space_memberships destination ON destination.person_id = p.id
  WHERE a.id = ? AND p.id = ? AND a.revoked_at IS NULL AND a.expires_at > ? AND p.disabled_at IS NULL
  AND own.space_id = ? AND own.role = 'owner' AND own.revoked_at IS NULL
  AND destination.space_id = ? AND destination.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = destination.space_id))`;
const destinationAvailable = `(? IS NULL OR EXISTS (SELECT 1 FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND archived_at IS NULL))
  AND (? IS NULL OR EXISTS (SELECT 1 FROM album_sections WHERE id = ? AND album_id = ? AND deleted_at IS NULL))`;

// A retry can only refer to the same person's exact source, revision and destination; cancelled IDs stay cancelled.
function assertMatchingPublication(job: PublicationRow, access: AccountSpaceAccess, input: PublicationInput) {
  if (job.person_id !== access.personId || job.source_space_id !== access.space_id || job.source_id !== input.sourceId ||
      job.source_revision !== input.sourceRevision || job.destination_space_id !== input.destinationSpaceId ||
      job.album_id !== (input.albumId || null) || job.section_id !== (input.sectionId || null)) {
    throw new AccountError(409, "This publication belongs to a different selection. Review it again.");
  }
  if (["cancelled", "cancelling"].includes(job.phase)) throw new AccountError(409, "This publication was cancelled. Review a new copy to continue.");
}

// Reserve original and preview storage atomically, without making the destination file browsable.
// Personal names enter the shared feed only after the checksum-verified object and live permissions are committed.
export async function reservePublication(database: D1Database, source: AccountSpaceAccess, destination: AccountSpaceAccess,
  input: PublicationInput, destinationLimit: number, now = Date.now()) {
  if (source.space_kind !== "personal" || destination.space_kind !== "shared" || source.personId !== destination.personId) {
    throw new AccountError(403, "Publish from My space into one of your shared libraries.");
  }
  if (input.sectionId && !input.albumId) throw new AccountError(400, "Choose an album for this section.");
  const existing = await database.prepare("SELECT * FROM publications WHERE id = ?").bind(input.id).first<PublicationRow>();
  if (existing) { assertMatchingPublication(existing, source, input); return existing; }
  const marker = `publication:${crypto.randomUUID()}`;
  try {
    const results = await database.batch([
      database.prepare(`INSERT INTO media (id, space_id, device_id, name, mime, size, sha256, category, object_key, upload_id, part_size,
        status, created_at, original_name, captured_at, preview_size)
        SELECT ?, ?, ?, original.name, original.mime, original.size, original.sha256, original.category, ?, ?, 0, 'publishing', ?,
          COALESCE(original.original_name, original.name), original.captured_at, CASE WHEN original.preview_ready = 1 THEN original.preview_size ELSE 0 END
        FROM media original WHERE original.id = ? AND original.space_id = ? AND original.revision = ? AND original.status = 'ready'
        AND original.archived_at IS NULL AND original.size <= ? AND ${publicationAuthority} AND ${destinationAvailable}
        AND (SELECT COALESCE(SUM(size + preview_size), 0) FROM media WHERE space_id = ?) + original.size +
          CASE WHEN original.preview_ready = 1 THEN original.preview_size ELSE 0 END <= ?`)
        .bind(input.id, destination.space_id, destination.id, `${destination.space_id}/${input.id}/pending`, marker, now,
          input.sourceId, source.space_id, input.sourceRevision, MAX_PUBLICATION_BYTES,
          source.sessionId, source.personId, now, source.space_id, destination.space_id,
          input.albumId || null, input.albumId || null, destination.space_id, input.sectionId || null, input.sectionId || null, input.albumId || null,
          destination.space_id, destinationLimit),
      database.prepare(`INSERT INTO publications (id, source_id, source_space_id, destination_space_id, person_id, source_revision, album_id, section_id, created_at)
        SELECT id, ?, ?, space_id, ?, ?, ?, ?, ? FROM media WHERE id = ? AND upload_id = ? AND status = 'publishing'`)
        .bind(input.sourceId, source.space_id, source.personId, input.sourceRevision, input.albumId || null, input.sectionId || null, now, input.id, marker),
    ]);
    if (!results[0].meta.changes) throw new AccountError(409, "The file or destination changed, or the destination has insufficient storage. Refresh and review the copy again.");
  } catch (failure) {
    const winner = await database.prepare("SELECT * FROM publications WHERE id = ?").bind(input.id).first<PublicationRow>();
    if (!winner) throw failure;
    assertMatchingPublication(winner, source, input); return winner;
  }
  return (await database.prepare("SELECT * FROM publications WHERE id = ?").bind(input.id).first<PublicationRow>())!;
}

// Stream into a unique attempt object; an expired worker can never overwrite or delete a newer successful attempt.
// R2 validates the supplied original SHA-256 while receiving bytes, without buffering a large file in the Worker.
export async function finishPublication(database: D1Database, bucket: R2Bucket, source: AccountSpaceAccess, job: PublicationRow) {
  if (job.phase === "ready") return { published: true, id: job.id, destinationSpaceId: job.destination_space_id };
  const now = Date.now();
  const key = `${job.destination_space_id}/${job.id}/publication-${crypto.randomUUID()}/original`;
  const claims = await database.batch([database.prepare(`UPDATE publications SET phase = 'copying', attempt_key = ?, lease_expires_at = ?
    WHERE id = ? AND person_id = ? AND (phase = 'pending' OR (phase = 'copying' AND lease_expires_at <= ?))
    AND (SELECT COUNT(*) FROM publication_attempts WHERE publication_id = publications.id) < 10 AND ${publicationAuthority}`)
    .bind(key, now + 5 * 60 * 1000, job.id, source.personId, now, source.sessionId, source.personId, now, job.source_space_id, job.destination_space_id),
    database.prepare("INSERT INTO publication_attempts (object_key, publication_id, created_at) SELECT ?, id, ? FROM publications WHERE id = ? AND attempt_key = ? AND phase = 'copying'")
      .bind(key, now, job.id, key),
  ]);
  if (!claims[0].meta.changes) throw new AccountError(409, "This copy is running, its retry limit was reached, or access changed. Refresh or cancel the unfinished publication.");
  try {
    const reservation = await database.prepare("SELECT preview_size FROM media WHERE id = ? AND status = 'publishing'").bind(job.id).first<{ preview_size: number }>();
    if (!reservation) throw new AccountError(409, "The publication changed before copying began.");
    const original = await database.prepare("SELECT * FROM media WHERE id = ? AND space_id = ? AND revision = ? AND status = 'ready' AND archived_at IS NULL")
      .bind(job.source_id, job.source_space_id, job.source_revision).first<OriginalRow>();
    if (!original) throw new AccountError(409, "The personal original changed. Cancel this copy and review it again.");
    const object = await bucket.get(original.object_key);
    if (!object || object.size !== original.size) {
      if (object) await object.body.cancel();
      throw new AccountError(409, "The original could not be verified. Your personal file has not been changed.");
    }
    const copied = await bucket.put(key, object.body, { sha256: original.sha256, httpMetadata: { contentType: original.mime },
      customMetadata: { sha256: original.sha256, filename: original.name } });
    if (!copied || copied.size !== original.size || !copied.checksums.sha256) throw new AccountError(409, "The copy could not be verified.");
    let previewSize = 0;
    if (original.preview_ready && original.preview_size > 0 && original.preview_size <= Math.min(250000, reservation.preview_size)) {
      try {
        const preview = await bucket.get(`${original.object_key}.preview.jpg`);
        if (preview && preview.size === original.preview_size && preview.checksums.md5) {
          await bucket.put(`${key}.preview.jpg`, preview.body, { md5: preview.checksums.md5, httpMetadata: { contentType: "image/jpeg" } });
          previewSize = preview.size;
        } else if (preview) await preview.body.cancel();
      } catch { await bucket.delete(`${key}.preview.jpg`); /* A missing derivative does not invalidate verified original bytes. */ }
    }
    const committedAt = Date.now();
    const committed = await database.batch([
      database.prepare(`UPDATE media SET status = 'ready', object_key = ?, preview_ready = ?, preview_size = ? WHERE id = ? AND status = 'publishing'
        AND EXISTS (SELECT 1 FROM publications WHERE id = ? AND phase = 'copying' AND attempt_key = ?)
        AND EXISTS (SELECT 1 FROM media original WHERE original.id = ? AND original.space_id = ? AND original.revision = ? AND original.status = 'ready' AND original.archived_at IS NULL)
        AND ${publicationAuthority} AND ${destinationAvailable}`)
        .bind(key, previewSize > 0 ? 1 : 0, previewSize, job.id, job.id, key, job.source_id, job.source_space_id, job.source_revision,
          source.sessionId, source.personId, committedAt, job.source_space_id, job.destination_space_id,
          job.album_id, job.album_id, job.destination_space_id, job.section_id, job.section_id, job.album_id),
      database.prepare(`INSERT INTO album_media (album_id, media_id, section_id) SELECT ?, id, ? FROM media
        WHERE id = ? AND status = 'ready' AND object_key = ? AND ? IS NOT NULL ON CONFLICT DO NOTHING`)
        .bind(job.album_id, job.section_id, job.id, key, job.album_id),
      database.prepare(`UPDATE publications SET phase = 'ready', lease_expires_at = 0 WHERE id = ? AND attempt_key = ?
        AND EXISTS (SELECT 1 FROM media WHERE id = ? AND status = 'ready' AND object_key = ?)`)
        .bind(job.id, key, job.id, key),
    ]);
    if (!committed[0].meta.changes) throw new AccountError(409, "Access or the destination changed before publication. No shared file was published by this attempt.");
    // A prior attempt's separate key cannot be referenced by this successful media row.
    const stale = await database.prepare("SELECT object_key FROM publication_attempts WHERE publication_id = ? AND object_key <> ?").bind(job.id, key).all<{ object_key: string }>();
    for (const attempt of stale.results) await bucket.delete([attempt.object_key, `${attempt.object_key}.preview.jpg`]);
    return { published: true, id: job.id, destinationSpaceId: job.destination_space_id };
  } catch (failure) {
    const visible = await database.prepare("SELECT id FROM media WHERE id = ? AND status = 'ready' AND object_key = ?").bind(job.id, key).first();
    if (visible) return { published: true, id: job.id, destinationSpaceId: job.destination_space_id };
    await bucket.delete([key, `${key}.preview.jpg`]);
    await database.prepare("UPDATE publications SET phase = 'pending', lease_expires_at = 0 WHERE id = ? AND attempt_key = ? AND phase = 'copying'").bind(job.id, key).run();
    if (failure instanceof AccountError) throw failure;
    throw new AccountError(503, "The copy could not be verified. Retry, or cancel the unfinished publication in Storage.");
  }
}

// Both the publishing person and a destination owner can cancel unfinished copies without changing any original.
export async function cancelPublication(database: D1Database, bucket: R2Bucket, access: ActiveDevice & { personId?: string }, id: string) {
  const job = await database.prepare("SELECT * FROM publications WHERE id = ?").bind(id).first<PublicationRow>();
  if (!job || !((access.personId === job.person_id && access.space_id === job.source_space_id) ||
      (access.space_id === job.destination_space_id && (access.role === "owner" || access.personId === job.person_id)))) {
    throw new AccountError(404, "This publication is not available.");
  }
  if (job.phase === "ready") throw new AccountError(409, "This copy is already published. Manage it in the shared library.");
  const cancelled = await database.prepare("UPDATE publications SET phase = 'cancelling' WHERE id = ? AND phase IN ('pending','copying','cancelling')").bind(id).run();
  if (!cancelled.meta.changes && job.phase !== "cancelled") throw new AccountError(409, "The publication changed. Refresh its status.");
  const attempts = await database.prepare("SELECT object_key FROM publication_attempts WHERE publication_id = ?").bind(id).all<{ object_key: string }>();
  for (const attempt of attempts.results) await bucket.delete([attempt.object_key, `${attempt.object_key}.preview.jpg`]);
  await database.batch([
    database.prepare("DELETE FROM media WHERE id = ? AND status IN ('publishing','cancelling') AND EXISTS (SELECT 1 FROM publications WHERE id = ? AND phase = 'cancelling')").bind(id, id),
    database.prepare("UPDATE publications SET phase = 'cancelled', lease_expires_at = 0 WHERE id = ? AND phase = 'cancelling'").bind(id),
  ]);
  return { cancelled: true };
}
