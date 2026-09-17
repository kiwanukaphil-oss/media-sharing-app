ALTER TABLE `media` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `preview_ready` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_media_feed` ON `media` (`space_id`,`status`,`archived_at`,`created_at`,`id`);