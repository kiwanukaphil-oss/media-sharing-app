CREATE TABLE `recovery_watermarks` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`changed_at` integer NOT NULL,
	PRIMARY KEY(`issuer`, `subject`)
);
