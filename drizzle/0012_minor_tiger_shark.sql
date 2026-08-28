CREATE TABLE `performance_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`test_date` text NOT NULL,
	`distance_km` integer NOT NULL,
	`total_seconds` integer NOT NULL,
	`age` integer NOT NULL,
	`vam` text NOT NULL,
	`vo2` text NOT NULL,
	`fc_max` integer NOT NULL,
	`pace_seconds` text NOT NULL,
	`zones` text NOT NULL,
	`tempo_runs` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `performance_tests_athlete_date_idx` ON `performance_tests` (`athlete_name`,`test_date`);