CREATE TABLE `data_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`payload` text NOT NULL,
	`record_count` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`restored_by` text,
	`restored_at` integer
);
--> statement-breakpoint
CREATE INDEX `data_backups_created_idx` ON `data_backups` (`created_at`);