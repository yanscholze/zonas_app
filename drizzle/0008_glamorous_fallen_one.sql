CREATE TABLE `request_deduplication` (
	`id` text PRIMARY KEY NOT NULL,
	`request_token` text NOT NULL,
	`actor_email` text NOT NULL,
	`route` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_deduplication_expires_idx` ON `request_deduplication` (`expires_at`);