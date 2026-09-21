CREATE TABLE `membership_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_membership_events_space` ON `membership_events` (`space_id`);--> statement-breakpoint
CREATE TABLE `person_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`space_id` text NOT NULL,
	`created_by` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`accepted_at` integer,
	`accepted_by` text,
	`accepted_operation` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_invitations_token_hash_unique` ON `person_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_person_invitations_space` ON `person_invitations` (`space_id`);--> statement-breakpoint
ALTER TABLE `space_memberships` ADD `revision` integer DEFAULT 0 NOT NULL;