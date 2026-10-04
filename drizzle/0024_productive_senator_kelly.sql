CREATE TABLE IF NOT EXISTS `training_week_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`week_start` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`message` text,
	`remote_workouts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `training_week_publications_athlete_week_provider_idx` ON `training_week_publications` (`athlete_name`,`week_start`,`provider`);
