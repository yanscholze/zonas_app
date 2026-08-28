CREATE TABLE `athlete_races` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`name` text NOT NULL,
	`race_date` text NOT NULL,
	`distance` text NOT NULL,
	`city` text,
	`goal` text,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`distance` text NOT NULL,
	`result_time` text NOT NULL,
	`race_date` text,
	`event_name` text,
	`updated_at` integer NOT NULL
);
