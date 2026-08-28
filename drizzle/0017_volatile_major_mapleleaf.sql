CREATE TABLE `external_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`provider` text NOT NULL,
	`external_athlete_id` text,
	`scopes` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_sync_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_integrations_athlete_provider_idx` ON `external_integrations` (`athlete_name`,`provider`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`athlete_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`provider` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
