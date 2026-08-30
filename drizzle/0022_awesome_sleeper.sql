ALTER TABLE `athletes` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `athletes` ADD `archived_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `athletes_name_idx` ON `athletes` (`name`);