CREATE TABLE `request_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_rate_limits_actor_window_idx` ON `request_rate_limits` (`actor_email`,`window_start`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`event_type` text NOT NULL,
	`route` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_created_idx` ON `security_events` (`created_at`);