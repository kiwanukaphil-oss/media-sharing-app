CREATE TABLE `account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_account_deletion_person` ON `account_deletion_requests` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_deletion_pending` ON `account_deletion_requests` (`person_id`) WHERE "account_deletion_requests"."status" IN ('pending', 'review_required');