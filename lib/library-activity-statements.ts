import type { ActiveDevice } from "./server";

export type ActivityAction = "album.create" | "album.update" | "album.archive" | "album.remove" |
  "section.update" | "section.order" | "section.template" | "file.rename" | "file.date" |
  "file.add" | "file.remove" | "file.trash" | "file.restore" | "file.section" | "file.arrive" | "file.delete";
export type ActivityResource = { kind: "media" | "album"; id: string; revision?: number };

// Append immediately after the final guarded mutation. SQLite changes() reports that statement's
// affected rows; the event and mutation roll back together if either fails. No historic text is kept.
export function activityStatement(db: D1Database, device: Pick<ActiveDevice, "id" | "space_id">, action: ActivityAction, resources: ActivityResource[]) {
  return db.prepare(`INSERT INTO library_events(id,space_id,actor_id,action,resources,affected_count,created_at)
    SELECT ?,?,?,?,?,changes(),? WHERE changes()>0`)
    .bind(crypto.randomUUID(), device.space_id, device.id, action, JSON.stringify(resources), Date.now());
}

export function fileActivityResources(files: { id: string; expectedRevision: number }[]): ActivityResource[] {
  return files.map(file => ({ kind: "media", id: file.id, revision: file.expectedRevision + 1 }));
}

// Publication attributes the shared arrival to its destination membership, never the private source
// actor or source ID. Place this directly after the conditional transition to ready.
export function arrivalActivityStatement(db: D1Database, mediaId: string) {
  return db.prepare(`INSERT INTO library_events(id,space_id,actor_id,action,resources,affected_count,created_at)
    SELECT ?,space_id,device_id,'file.arrive',json_array(json_object('kind','media','id',id,'revision',revision)),1,?
    FROM media WHERE id=? AND status='ready' AND changes()>0`).bind(crypto.randomUUID(), Date.now(), mediaId);
}

