CREATE TABLE `intake_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`expected_bytes` integer NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`admission_id` text,
	FOREIGN KEY (`submission_id`) REFERENCES `intake_submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admission_id`) REFERENCES `closure_write_admissions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_part_number" CHECK("intake_capabilities"."part_number" BETWEEN 1 AND 16),
	CONSTRAINT "intake_part_size" CHECK("intake_capabilities"."expected_bytes" BETWEEN 1 AND 16777216),
	CONSTRAINT "intake_capability_expiry" CHECK("intake_capabilities"."expires_at">"intake_capabilities"."issued_at" AND "intake_capabilities"."expires_at"<="intake_capabilities"."issued_at"+60000)
);
--> statement-breakpoint
CREATE INDEX `idx_intake_capabilities_submission` ON `intake_capabilities` (`submission_id`);--> statement-breakpoint
CREATE TABLE `intake_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`person_id` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`phase` text DEFAULT 'reserved' NOT NULL,
	`attempt_key` text,
	`lease_expires_at` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `upload_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_submission_size" CHECK("intake_submissions"."size">0),
	CONSTRAINT "intake_submission_phase" CHECK("intake_submissions"."phase" IN ('reserved','starting','uploading','received','accepted','rejected','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_intake_submissions_request` ON `intake_submissions` (`request_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `intake_upload_attempts` (
	`object_key` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`upload_id` text,
	`state` text DEFAULT 'creating' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `intake_submissions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_attempt_state" CHECK("intake_upload_attempts"."state" IN ('creating','active','abort-acknowledged','uncertain'))
);
--> statement-breakpoint
CREATE INDEX `idx_intake_attempt_submission` ON `intake_upload_attempts` (`submission_id`);--> statement-breakpoint
CREATE TABLE `upload_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`space_id` text NOT NULL,
	`issuer_membership_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`title` text NOT NULL,
	`album_id` text NOT NULL,
	`section_id` text,
	`access_scope_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`max_files` integer NOT NULL,
	`max_file_bytes` integer NOT NULL,
	`max_bytes` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_scope_id`) REFERENCES `asset_scopes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_file_count" CHECK("upload_requests"."max_files" BETWEEN 1 AND 100),
	CONSTRAINT "intake_file_size" CHECK("upload_requests"."max_file_bytes" BETWEEN 1 AND 262144000),
	CONSTRAINT "intake_total_size" CHECK("upload_requests"."max_bytes" BETWEEN 1 AND 1073741824),
	CONSTRAINT "intake_file_allowance" CHECK("upload_requests"."max_file_bytes"<="upload_requests"."max_bytes"),
	CONSTRAINT "intake_expiry" CHECK("upload_requests"."expires_at">"upload_requests"."created_at" AND "upload_requests"."expires_at"<="upload_requests"."created_at"+604800000),
	CONSTRAINT "intake_state" CHECK("upload_requests"."state" IN ('draft','open','closed')),
	CONSTRAINT "intake_recipient_binding" CHECK(("upload_requests"."accepted_by" IS NULL)=("upload_requests"."accepted_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_requests_token_hash_unique` ON `upload_requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_upload_requests_space` ON `upload_requests` (`space_id`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER upload_request_destination BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM space_memberships m WHERE m.id=NEW.issuer_membership_id AND m.space_id=NEW.space_id)
    OR EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=NEW.space_id)
    OR NOT EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.album_id AND a.space_id=NEW.space_id AND a.access_scope_id IS NEW.access_scope_id)
    OR (NEW.section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM album_sections s WHERE s.id=NEW.section_id AND s.album_id=NEW.album_id))
    THEN RAISE(ABORT,'Incompatible intake destination') END;
END;
--> statement-breakpoint
CREATE TRIGGER upload_request_intent_immutable BEFORE UPDATE OF space_id,issuer_membership_id,recipient_email,title,album_id,section_id,access_scope_id,created_at,expires_at,max_files,max_file_bytes,max_bytes,token_hash ON upload_requests
WHEN NEW.space_id IS NOT OLD.space_id OR NEW.issuer_membership_id IS NOT OLD.issuer_membership_id OR (NEW.recipient_email IS NOT OLD.recipient_email AND NOT(NEW.recipient_email='' AND NEW.state='closed' AND NEW.revoked_at IS NOT NULL))
  OR NEW.title IS NOT OLD.title OR NEW.album_id IS NOT OLD.album_id OR NEW.section_id IS NOT OLD.section_id OR NEW.access_scope_id IS NOT OLD.access_scope_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.max_files IS NOT OLD.max_files
  OR NEW.max_file_bytes IS NOT OLD.max_file_bytes OR NEW.max_bytes IS NOT OLD.max_bytes OR (NEW.token_hash IS NOT OLD.token_hash AND NOT(NEW.token_hash='erased-intake:' || OLD.id AND NEW.state='closed' AND NEW.revoked_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'Intake intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER upload_request_revocation_immutable BEFORE UPDATE OF state,revoked_at ON upload_requests
WHEN (OLD.state='closed' AND NEW.state<>'closed') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Closed intake cannot reopen'); END;
--> statement-breakpoint
CREATE TRIGGER upload_request_recipient_immutable BEFORE UPDATE OF accepted_by,accepted_at ON upload_requests
WHEN OLD.accepted_by IS NOT NULL AND (NEW.accepted_by IS NOT OLD.accepted_by OR NEW.accepted_at IS NOT OLD.accepted_at)
BEGIN SELECT RAISE(ABORT,'Intake recipient is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER upload_request_issuer_removed AFTER UPDATE OF revoked_at,role ON space_memberships
WHEN NEW.revoked_at IS NOT NULL OR NEW.role<>'owner'
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),revision=revision+1 WHERE issuer_membership_id=NEW.id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER upload_request_scope_removed AFTER UPDATE OF revoked_at ON scope_grants
WHEN NEW.revoked_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.revoked_at),revision=revision+1 WHERE issuer_membership_id=NEW.membership_id AND access_scope_id=NEW.scope_id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER upload_request_album_removed AFTER UPDATE OF archived_at,deleted_at ON albums
WHEN NEW.archived_at IS NOT NULL OR NEW.deleted_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.deleted_at,NEW.archived_at),revision=revision+1 WHERE album_id=NEW.id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER upload_request_section_removed AFTER UPDATE OF deleted_at ON album_sections
WHEN NEW.deleted_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.deleted_at),revision=revision+1 WHERE album_id=NEW.album_id AND section_id=NEW.id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER upload_request_person_disabled AFTER UPDATE OF disabled_at ON people
WHEN NEW.disabled_at IS NOT NULL
BEGIN UPDATE upload_requests SET revoked_at=COALESCE(revoked_at,NEW.disabled_at),revision=revision+1 WHERE revoked_at IS NULL AND
  (accepted_by=NEW.id OR issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=NEW.id)); END;
--> statement-breakpoint
CREATE TRIGGER intake_submission_immutable BEFORE UPDATE OF request_id,person_id,size,sha256,created_at ON intake_submissions
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.person_id IS NOT OLD.person_id OR NEW.size IS NOT OLD.size
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Intake submission intent is immutable'); END;
