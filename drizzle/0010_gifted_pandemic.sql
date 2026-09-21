CREATE TABLE `account_space_actors` (
	`membership_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `space_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_space_actors_device_id_unique` ON `account_space_actors` (`device_id`);