CREATE TABLE `workout_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`week_start` text NOT NULL,
	`workout_day` text NOT NULL,
	`planned_minutes` integer,
	`planned_km` text,
	`actual_minutes` integer,
	`actual_km` text,
	`correct_percentage` integer NOT NULL,
	`wrong_percentage` integer NOT NULL,
	`classification` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workout_executions_athlete_created_idx` ON `workout_executions` (`athlete_name`,`created_at`);