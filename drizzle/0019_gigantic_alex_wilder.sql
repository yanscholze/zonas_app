CREATE TABLE `plan_template_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_name` text NOT NULL,
	`week_number` integer NOT NULL,
	`sessions_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_template_overrides_plan_week_idx` ON `plan_template_overrides` (`plan_name`,`week_number`);