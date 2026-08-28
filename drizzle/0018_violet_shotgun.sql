CREATE TABLE `financial_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`pix_key` text,
	`pix_name` text,
	`default_amount_cents` integer NOT NULL,
	`due_day` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `student_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`reference_month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text NOT NULL,
	`paid_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_payments_athlete_month_idx` ON `student_payments` (`athlete_name`,`reference_month`);