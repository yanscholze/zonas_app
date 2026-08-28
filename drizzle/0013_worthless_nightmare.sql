CREATE TABLE `athlete_planning` (
	`athlete_name` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`phase` text NOT NULL,
	`week_number` integer NOT NULL,
	`total_weeks` integer NOT NULL,
	`updated_at` integer NOT NULL
);
