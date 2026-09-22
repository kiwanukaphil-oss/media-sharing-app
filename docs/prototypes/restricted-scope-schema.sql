-- P4 prototype only. This file is deliberately outside the active migration journal.
-- Enable no restricted data until every runtime surface has integrated the audience predicate.
CREATE TABLE asset_scopes (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES space_memberships(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_asset_scopes_space ON asset_scopes(space_id);
CREATE TABLE scope_grants (
  scope_id TEXT NOT NULL REFERENCES asset_scopes(id),
  membership_id TEXT NOT NULL REFERENCES space_memberships(id),
  granted_by TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY(scope_id,membership_id)
);
CREATE INDEX idx_scope_grants_member ON scope_grants(membership_id,revoked_at);
CREATE TABLE asset_scope_events (
  id TEXT PRIMARY KEY NOT NULL,
  scope_id TEXT NOT NULL REFERENCES asset_scopes(id),
  actor_id TEXT NOT NULL REFERENCES people(id),
  membership_id TEXT REFERENCES space_memberships(id),
  action TEXT NOT NULL CHECK(action IN ('create','grant','revoke','administrator-grant')),
  created_at INTEGER NOT NULL
);
ALTER TABLE media ADD COLUMN access_scope_id TEXT REFERENCES asset_scopes(id);
ALTER TABLE albums ADD COLUMN access_scope_id TEXT REFERENCES asset_scopes(id);
ALTER TABLE library_events ADD COLUMN scope_ids TEXT NOT NULL DEFAULT '[null]' CHECK(json_valid(scope_ids) AND json_array_length(scope_ids)>0);
CREATE INDEX idx_media_scope ON media(space_id,access_scope_id,status,archived_at);
CREATE INDEX idx_albums_scope ON albums(space_id,access_scope_id,deleted_at);

-- A revoked membership never regains a restricted grant simply by rejoining or restoring access.
CREATE TRIGGER revoke_departing_scope_grants AFTER UPDATE OF revoked_at ON space_memberships
WHEN NEW.revoked_at IS NOT NULL BEGIN
  UPDATE scope_grants SET revoked_at=COALESCE(revoked_at,NEW.revoked_at) WHERE membership_id=NEW.id;
END;
CREATE TRIGGER scope_must_be_shared BEFORE INSERT ON asset_scopes BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=NEW.space_id)
    OR NOT EXISTS(SELECT 1 FROM space_memberships WHERE id=NEW.created_by AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible scope') END;
END;
CREATE TRIGGER scope_space_immutable BEFORE UPDATE OF space_id ON asset_scopes
WHEN NEW.space_id IS NOT OLD.space_id BEGIN SELECT RAISE(ABORT,'Scope space is immutable'); END;
CREATE TRIGGER scope_grant_same_space BEFORE INSERT ON scope_grants BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes s JOIN space_memberships m ON m.space_id=s.space_id
    WHERE s.id=NEW.scope_id AND m.id=NEW.membership_id) THEN RAISE(ABORT,'Incompatible grant') END;
END;
CREATE TRIGGER scope_grant_identity_immutable BEFORE UPDATE OF scope_id,membership_id ON scope_grants
WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.membership_id IS NOT OLD.membership_id
BEGIN SELECT RAISE(ABORT,'Grant identity is immutable'); END;
CREATE TRIGGER media_scope_immutable BEFORE UPDATE OF access_scope_id,space_id ON media
WHEN NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.space_id IS NOT OLD.space_id
BEGIN SELECT RAISE(ABORT,'Use an explicit cross-scope copy'); END;
CREATE TRIGGER album_scope_immutable BEFORE UPDATE OF access_scope_id,space_id ON albums
WHEN NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.space_id IS NOT OLD.space_id
BEGIN SELECT RAISE(ABORT,'Album audience is immutable'); END;
CREATE TRIGGER media_scope_same_space BEFORE INSERT ON media WHEN NEW.access_scope_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible asset scope') END;
END;
CREATE TRIGGER album_scope_same_space BEFORE INSERT ON albums WHEN NEW.access_scope_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible album scope') END;
END;
CREATE TRIGGER album_reference_same_scope BEFORE INSERT ON album_media BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM albums a JOIN media m ON m.space_id=a.space_id AND m.access_scope_id IS a.access_scope_id
    WHERE a.id=NEW.album_id AND m.id=NEW.media_id) THEN RAISE(ABORT,'Incompatible album reference') END;
END;
CREATE TRIGGER album_reference_update_same_scope BEFORE UPDATE OF album_id,media_id ON album_media BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM albums a JOIN media m ON m.space_id=a.space_id AND m.access_scope_id IS a.access_scope_id
    WHERE a.id=NEW.album_id AND m.id=NEW.media_id) THEN RAISE(ABORT,'Incompatible album reference') END;
END;
