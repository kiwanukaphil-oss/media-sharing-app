CREATE TABLE `album_sections` (
	`album_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`album_id`, `id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_album_media` (
	`album_id` text NOT NULL,
	`media_id` text NOT NULL,
	`section_id` text,
	PRIMARY KEY(`album_id`, `media_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`album_id`,`section_id`) REFERENCES `album_sections`(`album_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_album_media`("album_id", "media_id", "section_id") SELECT "album_id", "media_id", NULL FROM `album_media`;--> statement-breakpoint
DROP TABLE `album_media`;--> statement-breakpoint
ALTER TABLE `__new_album_media` RENAME TO `album_media`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `idx_album_media_file` ON `album_media` (`media_id`);
