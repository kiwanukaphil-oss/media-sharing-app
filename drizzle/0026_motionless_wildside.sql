CREATE TABLE `delivery_items` (
	`delivery_id` text NOT NULL,
	`media_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`captured_at` text,
	PRIMARY KEY(`delivery_id`, `media_id`),
	FOREIGN KEY (`delivery_id`) REFERENCES `delivery_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_item_position" CHECK("delivery_items"."position" BETWEEN 0 AND 99),
	CONSTRAINT "delivery_item_size" CHECK("delivery_items"."size">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_delivery_item_position` ON `delivery_items` (`delivery_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_delivery_item_media` ON `delivery_items` (`media_id`);--> statement-breakpoint
CREATE TABLE `delivery_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`delivery_id`) REFERENCES `delivery_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_recipient_binding" CHECK(("delivery_recipients"."accepted_by" IS NULL)=("delivery_recipients"."accepted_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_recipients_token_hash_unique` ON `delivery_recipients` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_delivery_recipient_delivery` ON `delivery_recipients` (`delivery_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_delivery_recipient_email` ON `delivery_recipients` (`delivery_id`,`email`) WHERE "delivery_recipients"."email"<>'';--> statement-breakpoint
CREATE TABLE `delivery_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`issuer_membership_id` text NOT NULL,
	`access_scope_id` text,
	`title` text NOT NULL,
	`sender_name` text DEFAULT 'Relay member' NOT NULL,
	`intent_hash` text NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_scope_id`) REFERENCES `asset_scopes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_file_count" CHECK("delivery_snapshots"."file_count" BETWEEN 1 AND 100),
	CONSTRAINT "delivery_total_bytes" CHECK("delivery_snapshots"."total_bytes">0),
	CONSTRAINT "delivery_expiry" CHECK("delivery_snapshots"."expires_at">"delivery_snapshots"."created_at" AND "delivery_snapshots"."expires_at"<="delivery_snapshots"."created_at"+2592000000),
	CONSTRAINT "delivery_state" CHECK("delivery_snapshots"."state" IN ('draft','issued','suspended','revoked'))
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_snapshot_space` ON `delivery_snapshots` (`space_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER delivery_source_intent BEFORE INSERT ON delivery_snapshots BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM space_memberships WHERE id=NEW.issuer_membership_id AND space_id=NEW.space_id)
    OR (NEW.access_scope_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_scopes WHERE id=NEW.access_scope_id AND space_id=NEW.space_id))
    THEN RAISE(ABORT,'Incompatible delivery source') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_intent_immutable BEFORE UPDATE OF space_id,issuer_membership_id,access_scope_id,intent_hash,title,sender_name,file_count,total_bytes,created_at,expires_at ON delivery_snapshots
WHEN NEW.space_id IS NOT OLD.space_id OR NEW.issuer_membership_id IS NOT OLD.issuer_membership_id OR NEW.access_scope_id IS NOT OLD.access_scope_id
  OR ((NEW.intent_hash IS NOT OLD.intent_hash OR NEW.title IS NOT OLD.title OR NEW.sender_name IS NOT OLD.sender_name)
    AND NOT(NEW.state='revoked' AND NEW.revoked_at IS NOT NULL AND NEW.intent_hash='erased-delivery:' || OLD.id AND NEW.title='Deleted delivery' AND NEW.sender_name='Deleted member'))
  OR NEW.file_count IS NOT OLD.file_count OR NEW.total_bytes IS NOT OLD.total_bytes
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT,'Delivery intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_revocation_immutable BEFORE UPDATE OF state,revoked_at ON delivery_snapshots
WHEN (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Revoked delivery cannot reopen'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_item_insert BEFORE INSERT ON delivery_items BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM delivery_snapshots d JOIN media m ON m.id=NEW.media_id
    WHERE d.id=NEW.delivery_id AND d.state='draft' AND m.space_id=d.space_id AND m.access_scope_id IS d.access_scope_id
      AND m.status='ready' AND m.archived_at IS NULL AND m.revision=NEW.source_revision AND m.name=NEW.name AND m.mime=NEW.mime
      AND m.size=NEW.size AND m.sha256=NEW.sha256 AND m.captured_at IS NEW.captured_at)
    THEN RAISE(ABORT,'Delivery item must capture the current original') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_item_immutable BEFORE UPDATE ON delivery_items
BEGIN SELECT RAISE(ABORT,'Delivery snapshot items are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_recipient_immutable BEFORE UPDATE OF delivery_id,email,token_hash,accepted_by,accepted_at,revoked_at ON delivery_recipients
WHEN NEW.delivery_id IS NOT OLD.delivery_id
  OR ((NEW.email IS NOT OLD.email OR NEW.token_hash IS NOT OLD.token_hash)
    AND NOT(NEW.revoked_at IS NOT NULL AND NEW.email='' AND NEW.token_hash='erased-delivery-recipient:' || OLD.id))
  OR (OLD.accepted_by IS NOT NULL AND (NEW.accepted_by IS NOT OLD.accepted_by OR NEW.accepted_at IS NOT OLD.accepted_at))
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Delivery recipient cannot rebind'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_recipient_bound BEFORE INSERT ON delivery_recipients BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM delivery_snapshots WHERE id=NEW.delivery_id AND state='draft')
    OR (SELECT COUNT(*) FROM delivery_recipients WHERE delivery_id=NEW.delivery_id)>=20
    THEN RAISE(ABORT,'Review recipients before issuing delivery') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_source_changed AFTER UPDATE OF archived_at,status,space_id,access_scope_id,size,sha256 ON media
WHEN NEW.archived_at IS NOT NULL OR NEW.status<>'ready' OR NEW.space_id IS NOT OLD.space_id OR NEW.access_scope_id IS NOT OLD.access_scope_id OR NEW.size<>OLD.size OR NEW.sha256<>OLD.sha256
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND id IN(SELECT delivery_id FROM delivery_items WHERE media_id=NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER delivery_source_removed AFTER DELETE ON media
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND id IN(SELECT delivery_id FROM delivery_items WHERE media_id=OLD.id);
  DELETE FROM delivery_items WHERE media_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER delivery_issuer_removed AFTER UPDATE OF revoked_at,role ON space_memberships
WHEN NEW.revoked_at IS NOT NULL OR NEW.role<>'owner'
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER delivery_scope_removed AFTER UPDATE OF revoked_at ON scope_grants
WHEN NEW.revoked_at IS NOT NULL
BEGIN UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id=NEW.membership_id AND access_scope_id=NEW.scope_id; END;
--> statement-breakpoint
CREATE TRIGGER delivery_person_disabled AFTER UPDATE OF disabled_at ON people
WHEN NEW.disabled_at IS NOT NULL
BEGIN
  UPDATE delivery_snapshots SET state='suspended',revision=revision+1 WHERE state='issued' AND issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=NEW.id);
  UPDATE delivery_recipients SET revoked_at=COALESCE(revoked_at,NEW.disabled_at) WHERE accepted_by=NEW.id;
END;
