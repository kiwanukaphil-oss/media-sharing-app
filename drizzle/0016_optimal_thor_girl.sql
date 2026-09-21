ALTER TABLE `account_sessions` ADD `authenticated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `credentials_changed_at` integer DEFAULT 0 NOT NULL;