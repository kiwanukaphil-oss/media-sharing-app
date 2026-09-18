ALTER TABLE `devices` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `invitations` ADD `created_by` text REFERENCES devices(id);--> statement-breakpoint
-- Existing spaces retain their earliest active device as owner; inactive spaces require operator recovery.
UPDATE devices SET role = 'owner' WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY space_id ORDER BY created_at, id) AS position
    FROM devices WHERE revoked_at IS NULL AND expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
  ) WHERE position = 1
);--> statement-breakpoint
-- Legacy invitations have no accountable issuer. Owners can issue fresh ten-minute invitations.
UPDATE invitations SET redeemed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE created_by IS NULL AND redeemed_at IS NULL;
