CREATE TABLE `album_media` (
	`album_id` text NOT NULL,
	`media_id` text NOT NULL,
	PRIMARY KEY(`album_id`, `media_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_album_media_file` ON `album_media` (`media_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	`deleted_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_albums_space` ON `albums` (`space_id`,`deleted_at`,`archived_at`);--> statement-breakpoint
ALTER TABLE `media` ADD `original_name` text;--> statement-breakpoint
ALTER TABLE `media` ADD `captured_at` text;--> statement-breakpoint
ALTER TABLE `media` ADD `upload_batch` text;--> statement-breakpoint
ALTER TABLE `media` ADD `revision` integer DEFAULT 0 NOT NULL;