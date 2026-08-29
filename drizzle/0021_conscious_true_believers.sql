CREATE TABLE `pain_report_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pain_report_updates_report_idx` ON `pain_report_updates` (`report_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `contacted_at` integer;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `coach_note` text;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `resolution` text;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `pain_reports` ADD `linked_week_start` text;--> statement-breakpoint
ALTER TABLE `workout_executions` ADD `status` text;--> statement-breakpoint
ALTER TABLE `workout_executions` ADD `note` text;--> statement-breakpoint
ALTER TABLE `workout_executions` ADD `average_heart_rate` integer;--> statement-breakpoint
ALTER TABLE `workout_executions` ADD `average_pace_seconds` integer;--> statement-breakpoint
ALTER TABLE `workout_executions` ADD `external_activity_id` text;