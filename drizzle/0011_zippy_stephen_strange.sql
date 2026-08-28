CREATE TABLE `athlete_profiles` (
	`athlete_name` text PRIMARY KEY NOT NULL,
	`phone` text,
	`birth_date` text,
	`objective` text,
	`integration` text,
	`training_days` text NOT NULL,
	`updated_at` integer NOT NULL
);
