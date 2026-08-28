CREATE TABLE `athletes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`distance` text NOT NULL,
	`phase` text NOT NULL,
	`week` text NOT NULL,
	`next_workout` text NOT NULL,
	`status` text,
	`phone` text,
	`email` text,
	`training_days` text,
	`integration` text,
	`created_at` integer NOT NULL
);
