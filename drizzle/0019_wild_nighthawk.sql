CREATE TABLE `closure_backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`receipt_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `closure_write_admissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closure_backup_runs_snapshot_id_unique` ON `closure_backup_runs` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `closure_fences` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`request_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`generation` integer NOT NULL,
	`phase` text NOT NULL,
	`plan_digest` text NOT NULL,
	`decision_digest` text NOT NULL,
	`approval_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `account_deletion_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "closure_fence_generation" CHECK("closure_fences"."generation" > 0),
	CONSTRAINT "closure_fence_phase" CHECK("closure_fences"."phase" IN ('draining','review_required'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closure_fences_person_id_unique` ON `closure_fences` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `closure_fences_request_id_unique` ON `closure_fences` (`request_id`);--> statement-breakpoint
CREATE TABLE `closure_storage_effects` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`object_key` text NOT NULL,
	`operation` text NOT NULL,
	`upload_id` text,
	`part_number` integer,
	`capability_expires_at` integer,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`acknowledged_at` integer,
	FOREIGN KEY (`admission_id`) REFERENCES `closure_write_admissions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "closure_effect_state" CHECK("closure_storage_effects"."state" IN ('active','acknowledged','uncertain')),
	CONSTRAINT "closure_effect_operation" CHECK("closure_storage_effects"."operation" IN ('put','multipart_create','multipart_part','multipart_complete','delete','multipart_abort','multipart_capability')),
	CONSTRAINT "closure_effect_capability" CHECK("closure_storage_effects"."operation"<>'multipart_capability' OR
    ("closure_storage_effects"."upload_id" IS NOT NULL AND "closure_storage_effects"."part_number" IS NOT NULL AND "closure_storage_effects"."part_number" BETWEEN 1 AND 10000 AND "closure_storage_effects"."capability_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_closure_storage_effects_admission` ON `closure_storage_effects` (`admission_id`,`state`);--> statement-breakpoint
CREATE TABLE `closure_write_admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`person_id` text,
	`device_id` text,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "closure_admission_generation" CHECK("closure_write_admissions"."generation" >= 0),
	CONSTRAINT "closure_admission_state" CHECK("closure_write_admissions"."state" IN ('active','settled','uncertain')),
	CONSTRAINT "closure_admission_actor" CHECK(("closure_write_admissions"."kind"='account' AND "closure_write_admissions"."person_id" IS NOT NULL AND "closure_write_admissions"."device_id" IS NULL) OR
    ("closure_write_admissions"."kind"='legacy' AND "closure_write_admissions"."person_id" IS NULL AND "closure_write_admissions"."device_id" IS NOT NULL) OR
    ("closure_write_admissions"."kind"='backup' AND "closure_write_admissions"."person_id" IS NULL AND "closure_write_admissions"."device_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_closure_admissions_state` ON `closure_write_admissions` (`state`,`kind`,`person_id`,`device_id`);