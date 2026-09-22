-- Isolated delivery preparation. No migration or deployment enables these grants yet.
CREATE TABLE delivery_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  issuer_membership_id TEXT NOT NULL REFERENCES space_memberships(id),
  access_scope_id TEXT REFERENCES asset_scopes(id),
  title TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK(file_count BETWEEN 1 AND 100),
  total_bytes INTEGER NOT NULL CHECK(total_bytes>0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+2592000000),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','issued','suspended','revoked')),
  revision INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX idx_delivery_snapshot_space ON delivery_snapshots(space_id,created_at,id);
CREATE TABLE delivery_items (
  delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id),
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 99),
  source_revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0),
  sha256 TEXT NOT NULL,
  captured_at TEXT,
  PRIMARY KEY(delivery_id,media_id),
  UNIQUE(delivery_id,position)
);
CREATE INDEX idx_delivery_item_media ON delivery_items(media_id);
CREATE TABLE delivery_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  accepted_by TEXT REFERENCES people(id),
  accepted_at INTEGER,
  revoked_at INTEGER,
  CHECK((accepted_by IS NULL)=(accepted_at IS NULL))
);
CREATE INDEX idx_delivery_recipient_delivery ON delivery_recipients(delivery_id);
CREATE UNIQUE INDEX idx_delivery_recipient_email ON delivery_recipients(delivery_id,email);
CREATE TRIGGER delivery_source_intent BEFORE INSERT ON delivery_snapshots BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM space_memberships WHERE id=NEW.issuer_membership_id AND space_id=NEW.space_id)
    OR (NEW.access_scope_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id))
    THEN RAISE(ABORT,'Incompatible delivery source') END;
END;
CREATE TRIGGER delivery_intent_immutable BEFORE UPDATE OF space_id,issuer_membership_id,access_scope_id,intent_hash,title,file_count,total_bytes,created_at,expires_at ON delivery_snapshots
WHEN NEW.space_id IS NOT OLD.space_id OR NEW.issuer_membership_id IS NOT OLD.issuer_membership_id OR NEW.access_scope_id IS NOT OLD.access_scope_id
  OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.title IS NOT OLD.title OR NEW.file_count IS NOT OLD.file_count OR NEW.total_bytes IS NOT OLD.total_bytes
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT,'Delivery intent is immutable'); END;
CREATE TRIGGER delivery_revocation_immutable BEFORE UPDATE OF state,revoked_at ON delivery_snapshots
WHEN (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Revoked delivery cannot reopen'); END;
CREATE TRIGGER delivery_item_insert BEFORE INSERT ON delivery_items BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM delivery_snapshots d JOIN media m ON m.id=NEW.media_id
    WHERE d.id=NEW.delivery_id AND d.state='draft' AND m.space_id=d.space_id AND m.access_scope_id IS d.access_scope_id
      AND m.status='ready' AND m.archived_at IS NULL AND m.revision=NEW.source_revision AND m.name=NEW.name AND m.mime=NEW.mime
      AND m.size=NEW.size AND m.sha256=NEW.sha256 AND m.captured_at IS NEW.captured_at)
    THEN RAISE(ABORT,'Delivery item must capture the current original') END;
END;
CREATE TRIGGER delivery_item_immutable BEFORE UPDATE ON delivery_items
BEGIN SELECT RAISE(ABORT,'Delivery snapshot items are immutable'); END;
CREATE TRIGGER delivery_recipient_immutable BEFORE UPDATE OF delivery_id,email,token_hash,accepted_by,accepted_at,revoked_at ON delivery_recipients
WHEN NEW.delivery_id IS NOT OLD.delivery_id OR NEW.email IS NOT OLD.email OR NEW.token_hash IS NOT OLD.token_hash
  OR (OLD.accepted_by IS NOT NULL AND (NEW.accepted_by IS NOT OLD.accepted_by OR NEW.accepted_at IS NOT OLD.accepted_at))
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Delivery recipient cannot rebind'); END;
CREATE TRIGGER delivery_recipient_bound BEFORE INSERT ON delivery_recipients BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM delivery_snapshots WHERE id=NEW.delivery_id AND state='draft')
    OR (SELECT COUNT(*) FROM delivery_recipients WHERE delivery_id=NEW.delivery_id)>=20
    THEN RAISE(ABORT,'Review recipients before issuing delivery') END;
END;
-- Suspension is sticky: restoration of a source or membership never silently renews external access.
CREATE TRIGGER delivery_source_changed AFTER UPDATE OF archived_at,status,space_id,access_scope_id,size,sha256 ON media
WHEN NEW.archived_at IS NOT NULL OR NEW.status<>'ready' OR NEW.space_id IS NOT OLD.space_id OR NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.size<>OLD.size OR NEW.sha256<>OLD.sha256
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND id IN(SELECT delivery_id FROM delivery_items WHERE media_id=NEW.id); END;
CREATE TRIGGER delivery_source_removed AFTER DELETE ON media
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND id IN(SELECT delivery_id FROM delivery_items WHERE media_id=OLD.id); END;
CREATE TRIGGER delivery_issuer_removed AFTER UPDATE OF revoked_at,role ON space_memberships
WHEN NEW.revoked_at IS NOT NULL OR NEW.role<>'owner'
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id=NEW.id; END;
CREATE TRIGGER delivery_scope_removed AFTER UPDATE OF revoked_at ON scope_grants
WHEN NEW.revoked_at IS NOT NULL
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id=NEW.membership_id AND access_scope_id=NEW.scope_id; END;
CREATE TRIGGER delivery_person_disabled AFTER UPDATE OF disabled_at ON people
WHEN NEW.disabled_at IS NOT NULL
BEGIN
  UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=NEW.id);
  UPDATE delivery_recipients SET revoked_at=COALESCE(revoked_at,NEW.disabled_at) WHERE accepted_by=NEW.id;
END;
