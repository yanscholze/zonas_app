CREATE TABLE `access_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`previous_email` text,
	`new_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_audit_log_athlete_created_idx` ON `access_audit_log` (`athlete_name`,`created_at`);