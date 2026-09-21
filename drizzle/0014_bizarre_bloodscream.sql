CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_space_id` text NOT NULL,
	`destination_space_id` text NOT NULL,
	`person_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`album_id` text,
	`section_id` text,
	`created_at` integer NOT NULL,
	`phase` text DEFAULT 'pending' NOT NULL,
	`attempt_key` text,
	`lease_expires_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_publications_person` ON `publications` (`person_id`);