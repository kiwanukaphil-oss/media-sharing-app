CREATE TABLE `library_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resources` text NOT NULL,
	`affected_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "library_event_resources" CHECK(json_valid("library_events"."resources") AND json_array_length("library_events"."resources") BETWEEN 1 AND 101),
	CONSTRAINT "library_event_count" CHECK("library_events"."affected_count" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `idx_library_events_page` ON `library_events` (`space_id`,`created_at`,`id`);