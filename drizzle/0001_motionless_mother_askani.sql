CREATE TABLE `training_weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`week_start` text NOT NULL,
	`plan` text NOT NULL,
	`phase` text NOT NULL,
	`week_label` text NOT NULL,
	`training_days` text NOT NULL,
	`sessions` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
