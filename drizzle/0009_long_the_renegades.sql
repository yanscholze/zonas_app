CREATE TABLE `training_week_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`week_start` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`changed_fields` text NOT NULL,
	`previous_snapshot` text,
	`new_snapshot` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `training_week_audit_athlete_week_idx` ON `training_week_audit` (`athlete_name`,`week_start`,`created_at`);