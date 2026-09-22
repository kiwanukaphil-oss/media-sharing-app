CREATE TABLE `asset_scope_events` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`membership_id` text,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scope_id`) REFERENCES `asset_scopes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "asset_scope_event_action" CHECK("asset_scope_events"."action" IN ('create','grant','revoke','administrator-grant'))
);
--> statement-breakpoint
CREATE TABLE `asset_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_asset_scopes_space` ON `asset_scopes` (`space_id`);--> statement-breakpoint
CREATE TABLE `scope_grants` (
	`scope_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	PRIMARY KEY(`scope_id`, `membership_id`),
	FOREIGN KEY (`scope_id`) REFERENCES `asset_scopes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_scope_grants_member` ON `scope_grants` (`membership_id`,`revoked_at`);--> statement-breakpoint
ALTER TABLE `albums` ADD `access_scope_id` text REFERENCES asset_scopes(id);--> statement-breakpoint
ALTER TABLE `library_events` ADD `scope_ids` text DEFAULT '[null]' NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `access_scope_id` text REFERENCES asset_scopes(id);
--> statement-breakpoint
CREATE TRIGGER revoke_departing_scope_grants AFTER UPDATE OF revoked_at ON space_memberships
WHEN NEW.revoked_at IS NOT NULL BEGIN
  UPDATE scope_grants SET revoked_at=COALESCE(revoked_at,NEW.revoked_at) WHERE membership_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER scope_must_be_shared BEFORE INSERT ON asset_scopes BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=NEW.space_id)
    OR NOT EXISTS(SELECT 1 FROM space_memberships WHERE id=NEW.created_by AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER scope_space_immutable BEFORE UPDATE OF space_id ON asset_scopes
WHEN NEW.space_id IS NOT OLD.space_id BEGIN SELECT RAISE(ABORT,'Scope space is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER scope_grant_same_space BEFORE INSERT ON scope_grants BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes s JOIN space_memberships m ON m.space_id=s.space_id
    WHERE s.id=NEW.scope_id AND m.id=NEW.membership_id) THEN RAISE(ABORT,'Incompatible grant') END;
END;
--> statement-breakpoint
CREATE TRIGGER scope_grant_identity_immutable BEFORE UPDATE OF scope_id,membership_id ON scope_grants
WHEN NEW.scope_id IS NOT OLD.scope_id OR NEW.membership_id IS NOT OLD.membership_id
BEGIN SELECT RAISE(ABORT,'Grant identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_scope_immutable BEFORE UPDATE OF access_scope_id,space_id ON media
WHEN NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.space_id IS NOT OLD.space_id
BEGIN SELECT RAISE(ABORT,'Use an explicit cross-scope copy'); END;
--> statement-breakpoint
CREATE TRIGGER album_scope_immutable BEFORE UPDATE OF access_scope_id,space_id ON albums
WHEN NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.space_id IS NOT OLD.space_id
BEGIN SELECT RAISE(ABORT,'Album audience is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_scope_same_space BEFORE INSERT ON media WHEN NEW.access_scope_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible asset scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER album_scope_same_space BEFORE INSERT ON albums WHEN NEW.access_scope_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id)
    THEN RAISE(ABORT,'Incompatible album scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER album_reference_same_scope BEFORE INSERT ON album_media BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM albums a JOIN media m ON m.space_id=a.space_id AND m.access_scope_id IS a.access_scope_id
    WHERE a.id=NEW.album_id AND m.id=NEW.media_id) THEN RAISE(ABORT,'Incompatible album reference') END;
END;
--> statement-breakpoint
CREATE TRIGGER album_reference_update_same_scope BEFORE UPDATE OF album_id,media_id ON album_media BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM albums a JOIN media m ON m.space_id=a.space_id AND m.access_scope_id IS a.access_scope_id
    WHERE a.id=NEW.album_id AND m.id=NEW.media_id) THEN RAISE(ABORT,'Incompatible album reference') END;
END;

--> statement-breakpoint
CREATE TRIGGER library_event_scope_valid BEFORE INSERT ON library_events BEGIN
  SELECT CASE WHEN NOT json_valid(NEW.scope_ids) THEN RAISE(ABORT,'Invalid event audience') END;
  SELECT CASE WHEN json_type(NEW.scope_ids)!='array' OR json_array_length(NEW.scope_ids) NOT BETWEEN 1 AND 101
    THEN RAISE(ABORT,'Invalid event audience') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.scope_ids) audience
    WHERE audience.type NOT IN ('null','text') OR (audience.type='text' AND NOT EXISTS
      (SELECT 1 FROM asset_scopes scope WHERE scope.id=audience.value AND scope.space_id=NEW.space_id)))
    THEN RAISE(ABORT,'Incompatible event audience') END;
END;
--> statement-breakpoint
CREATE TRIGGER library_event_scope_immutable BEFORE UPDATE OF scope_ids,space_id ON library_events
WHEN NEW.scope_ids IS NOT OLD.scope_ids OR NEW.space_id IS NOT OLD.space_id
BEGIN SELECT RAISE(ABORT,'Event audience is immutable'); END;
