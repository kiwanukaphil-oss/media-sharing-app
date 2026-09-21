CREATE TABLE `publication_attempts` (
	`object_key` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_publication_attempts_job` ON `publication_attempts` (`publication_id`);