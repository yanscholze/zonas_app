CREATE TABLE `training_feedbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`week_start` text,
	`workout_day` text,
	`feeling` text NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `training_feedbacks_status_created_idx` ON `training_feedbacks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `training_feedbacks_athlete_created_idx` ON `training_feedbacks` (`athlete_name`,`created_at`);