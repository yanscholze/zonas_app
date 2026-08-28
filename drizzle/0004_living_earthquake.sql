CREATE TABLE `athlete_access` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`invited_at` integer,
	`activated_at` integer,
	`last_access_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_access_athlete_name_idx` ON `athlete_access` (`athlete_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_access_email_idx` ON `athlete_access` (`email`);