-- Isolated protocol rehearsal only. Not in the migration journal; do not apply to production yet.
CREATE TABLE closure_fences (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL UNIQUE REFERENCES people(id),
  request_id TEXT NOT NULL UNIQUE REFERENCES account_deletion_requests(id),
  source_revision INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  phase TEXT NOT NULL CHECK(phase IN ('draining','review_required')),
  plan_digest TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  approval_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE closure_write_admissions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('account','legacy','backup')),
  person_id TEXT REFERENCES people(id),
  device_id TEXT REFERENCES devices(id),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  state TEXT NOT NULL CHECK(state IN ('active','settled','uncertain')),
  started_at INTEGER NOT NULL,
  settled_at INTEGER,
  CHECK((kind='account' AND person_id IS NOT NULL AND device_id IS NULL) OR
        (kind='legacy' AND person_id IS NULL AND device_id IS NOT NULL) OR
        (kind='backup' AND person_id IS NULL AND device_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX idx_closure_admissions_state ON closure_write_admissions(state,kind,person_id,device_id);
--> statement-breakpoint
CREATE TABLE closure_storage_effects (
  id TEXT PRIMARY KEY NOT NULL,
  admission_id TEXT NOT NULL REFERENCES closure_write_admissions(id),
  object_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('put','multipart_create','multipart_part','multipart_complete','delete','multipart_abort')),
  upload_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('active','acknowledged','uncertain')),
  started_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);
--> statement-breakpoint
CREATE INDEX idx_closure_storage_effects_admission ON closure_storage_effects(admission_id,state);
--> statement-breakpoint
CREATE TABLE closure_backup_runs (
  id TEXT PRIMARY KEY NOT NULL REFERENCES closure_write_admissions(id),
  snapshot_id TEXT NOT NULL UNIQUE,
  receipt_digest TEXT,
  created_at INTEGER NOT NULL
);
