CREATE TABLE `personal_favorites` (
	`person_id` text NOT NULL,
	`media_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`person_id`, `media_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_favorites_media` ON `personal_favorites` (`media_id`);