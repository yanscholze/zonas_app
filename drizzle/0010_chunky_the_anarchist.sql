CREATE TABLE `application_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`area` text NOT NULL,
	`error_code` text NOT NULL,
	`method` text NOT NULL,
	`status_code` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `application_errors_created_idx` ON `application_errors` (`created_at`);