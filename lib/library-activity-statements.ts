import type { ActiveDevice } from "./server";

export type ActivityAction = "album.create" | "album.update" | "album.archive" | "album.remove" |
  "section.update" | "section.order" | "section.template" | "file.rename" | "file.date" |
  "file.add" | "file.remove" | "file.trash" | "file.restore" | "file.section" | "file.arrive" | "file.delete";
export type ActivityResource = { kind: "media" | "album"; id: string; revision?: number; retainedScope?: string | null };

// Append immediately after the final guarded mutation. SQLite changes() reports that statement's
// affected rows; the event and mutation roll back together if either fails. No historic text is kept.
export function activityStatement(db: D1Database, device: Pick<ActiveDevice, "id" | "space_id">, action: ActivityAction, resources: ActivityResource[], eventId = crypto.randomUUID()) {
  // Resolve immutable scopes in the same transaction; a missing resource fails the insert instead
  // of silently labelling a restricted event general. Only deletion supplies a server-retained scope.
  const references = JSON.stringify(resources);
  const publicReferences = JSON.stringify(resources.map(({ kind, id, revision }) => ({ kind, id, ...(revision === undefined ? {} : { revision }) })));
  return db.prepare(`INSERT INTO library_events(id,space_id,actor_id,action,resources,affected_count,created_at,scope_ids)
    SELECT ?,?,?,?,?,changes(),?,(SELECT CASE WHEN MIN(found)=1 THEN json_group_array(DISTINCT scope) ELSE NULL END FROM (
      SELECT CASE WHEN json_type(r.value,'$.retainedScope') IS NOT NULL THEN json_extract(r.value,'$.retainedScope')
        WHEN json_extract(r.value,'$.kind')='media' THEN m.access_scope_id ELSE a.access_scope_id END AS scope,
        CASE WHEN json_type(r.value,'$.retainedScope') IS NOT NULL OR m.id IS NOT NULL OR a.id IS NOT NULL THEN 1 ELSE 0 END AS found
      FROM json_each(?) r LEFT JOIN media m ON json_extract(r.value,'$.kind')='media' AND m.id=json_extract(r.value,'$.id') AND m.space_id=?
      LEFT JOIN albums a ON json_extract(r.value,'$.kind')='album' AND a.id=json_extract(r.value,'$.id') AND a.space_id=?))
    WHERE changes()>0`)
    .bind(eventId, device.space_id, device.id, action, publicReferences, Date.now(), references, device.space_id, device.space_id);
}

export function fileActivityResources(files: { id: string; expectedRevision: number }[]): ActivityResource[] {
  return files.map(file => ({ kind: "media", id: file.id, revision: file.expectedRevision + 1 }));
}

// Publication attributes the shared arrival to its destination membership, never the private source
// actor or source ID. Place this directly after the conditional transition to ready.
export function arrivalActivityStatement(db: D1Database, mediaId: string) {
  return db.prepare(`INSERT INTO library_events(id,space_id,actor_id,action,resources,affected_count,created_at,scope_ids)
    SELECT ?,space_id,device_id,'file.arrive',json_array(json_object('kind','media','id',id,'revision',revision)),1,?,json_array(access_scope_id)
    FROM media WHERE id=? AND status='ready' AND changes()>0`).bind(crypto.randomUUID(), Date.now(), mediaId);
}

