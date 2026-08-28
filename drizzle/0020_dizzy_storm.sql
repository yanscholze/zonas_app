CREATE TABLE `device_ingest_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `device_ingest_tokens_athlete_idx` ON `device_ingest_tokens` (`athlete_name`,`provider`);--> statement-breakpoint
CREATE TABLE `external_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`provider` text NOT NULL,
	`external_activity_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`sport` text NOT NULL,
	`distance_meters` integer,
	`moving_seconds` integer,
	`elapsed_seconds` integer,
	`average_heart_rate` integer,
	`average_pace_seconds` integer,
	`raw_payload` text,
	`matched_week_start` text,
	`matched_workout_day` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_activities_provider_activity_idx` ON `external_activities` (`provider`,`external_activity_id`);--> statement-breakpoint
CREATE INDEX `external_activities_athlete_started_idx` ON `external_activities` (`athlete_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `oauth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`provider` text NOT NULL,
	`code_verifier` text,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`athlete_name` text,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`status` text NOT NULL,
	`must_change_password` integer NOT NULL,
	`failed_attempts` integer NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_email_idx` ON `user_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_sessions_expires_idx` ON `user_sessions` (`expires_at`);--> statement-breakpoint
DROP TABLE `oauth_states`;