-- Isolated schema preparation only: not an active migration or production capability.
CREATE TABLE upload_requests (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  issuer_membership_id TEXT NOT NULL REFERENCES space_memberships(id),
  recipient_email TEXT NOT NULL,
  accepted_by TEXT REFERENCES people(id),
  accepted_at INTEGER,
  title TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  section_id TEXT,
  access_scope_id TEXT REFERENCES asset_scopes(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  max_files INTEGER NOT NULL CHECK(max_files BETWEEN 1 AND 100),
  max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes BETWEEN 1 AND 262144000),
  max_bytes INTEGER NOT NULL CHECK(max_bytes BETWEEN 1 AND 1073741824),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','open','closed')),
  revision INTEGER NOT NULL DEFAULT 0,
  CHECK(expires_at>created_at AND expires_at<=created_at+604800000),
  CHECK(max_file_bytes<=max_bytes),
  CHECK((accepted_by IS NULL)=(accepted_at IS NULL))
);
CREATE INDEX idx_upload_requests_space ON upload_requests(space_id,expires_at);
CREATE TRIGGER upload_request_destination BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM space_memberships m WHERE m.id=NEW.issuer_membership_id AND m.space_id=NEW.space_id)
    OR EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=NEW.space_id)
    OR NOT EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.album_id AND a.space_id=NEW.space_id AND a.access_scope_id IS NEW.access_scope_id)
    OR (NEW.section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM album_sections s WHERE s.id=NEW.section_id AND s.album_id=NEW.album_id))
    THEN RAISE(ABORT,'Incompatible intake destination') END;
END;
CREATE TRIGGER upload_request_intent_immutable BEFORE UPDATE OF space_id,issuer_membership_id,recipient_email,title,album_id,section_id,access_scope_id,created_at,expires_at,max_files,max_file_bytes,max_bytes,token_hash ON upload_requests
WHEN NEW.space_id IS NOT OLD.space_id OR NEW.issuer_membership_id IS NOT OLD.issuer_membership_id OR NEW.recipient_email IS NOT OLD.recipient_email
  OR NEW.title IS NOT OLD.title OR NEW.album_id IS NOT OLD.album_id OR NEW.section_id IS NOT OLD.section_id OR NEW.access_scope_id IS NOT OLD.access_scope_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.max_files IS NOT OLD.max_files
  OR NEW.max_file_bytes IS NOT OLD.max_file_bytes OR NEW.max_bytes IS NOT OLD.max_bytes OR NEW.token_hash IS NOT OLD.token_hash
BEGIN SELECT RAISE(ABORT,'Intake intent is immutable'); END;
CREATE TRIGGER upload_request_recipient_immutable BEFORE UPDATE OF accepted_by,accepted_at ON upload_requests
WHEN OLD.accepted_by IS NOT NULL AND (NEW.accepted_by IS NOT OLD.accepted_by OR NEW.accepted_at IS NOT OLD.accepted_at)
BEGIN SELECT RAISE(ABORT,'Intake recipient is immutable'); END;
-- A departed or demoted issuer cannot regain old request authority by rejoining or being promoted.
CREATE TRIGGER upload_request_issuer_removed AFTER UPDATE OF revoked_at,role ON space_memberships
WHEN NEW.revoked_at IS NOT NULL OR NEW.role<>'owner'
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),revision=revision+1 WHERE issuer_membership_id=NEW.id AND revoked_at IS NULL; END;

CREATE TRIGGER upload_request_scope_removed AFTER UPDATE OF revoked_at ON scope_grants
WHEN NEW.revoked_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.revoked_at),revision=revision+1 WHERE issuer_membership_id=NEW.membership_id AND access_scope_id=NEW.scope_id AND revoked_at IS NULL; END;
CREATE TRIGGER upload_request_album_removed AFTER UPDATE OF archived_at,deleted_at ON albums
WHEN NEW.archived_at IS NOT NULL OR NEW.deleted_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.deleted_at,NEW.archived_at),revision=revision+1 WHERE album_id=NEW.id AND revoked_at IS NULL; END;
CREATE TRIGGER upload_request_section_removed AFTER UPDATE OF deleted_at ON album_sections
WHEN NEW.deleted_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.deleted_at),revision=revision+1 WHERE album_id=NEW.album_id AND section_id=NEW.id AND revoked_at IS NULL; END;
CREATE TRIGGER upload_request_person_disabled AFTER UPDATE OF disabled_at ON people
WHEN NEW.disabled_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.disabled_at),revision=revision+1 WHERE revoked_at IS NULL AND
  (accepted_by=NEW.id OR issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=NEW.id)); END;

-- A submission keeps exact byte intent and custody even if later cleanup removes a media row.
CREATE TABLE intake_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES upload_requests(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  size INTEGER NOT NULL CHECK(size>0),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'reserved' CHECK(phase IN ('reserved','uploading','received','accepted','cancelled'))
);
CREATE INDEX idx_intake_submissions_request ON intake_submissions(request_id,person_id);
CREATE TRIGGER intake_submission_immutable BEFORE UPDATE OF request_id,person_id,size,sha256,created_at ON intake_submissions
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.person_id IS NOT OLD.person_id OR NEW.size IS NOT OLD.size
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Intake submission intent is immutable'); END;
