CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`objective` text,
	`distance` text NOT NULL,
	`training_days` text NOT NULL,
	`integration` text NOT NULL,
	`status` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_email_idx` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `access_requests_status_idx` ON `access_requests` (`status`,`created_at`);