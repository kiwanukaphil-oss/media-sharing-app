ALTER TABLE `account_sessions` ADD `session_mode` text DEFAULT 'trusted' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_sessions` ADD `provider_session_id` text;--> statement-breakpoint
ALTER TABLE `auth_transactions` ADD `session_mode` text DEFAULT 'temporary' NOT NULL;