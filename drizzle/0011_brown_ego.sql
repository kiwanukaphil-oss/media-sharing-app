CREATE TABLE `personal_spaces` (
	`space_id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`quota_bytes` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_spaces_person_id_unique` ON `personal_spaces` (`person_id`);