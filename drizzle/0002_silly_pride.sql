CREATE TABLE `pain_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`body_area` text NOT NULL,
	`intensity` integer NOT NULL,
	`training_impact` text NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
