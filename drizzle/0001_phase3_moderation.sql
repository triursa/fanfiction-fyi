-- Phase 3: Moderation, Reports & Account Controls schema migration
-- Issues #89, #90, #91, #93

-- #91: Add suspended_until to users table for temporary suspension
ALTER TABLE `users` ADD COLUMN `suspended_until` text;

-- #89: Add updated_at to comments table for edit tracking
ALTER TABLE `comments` ADD COLUMN `updated_at` text;

-- #90: Content reports table
CREATE TABLE `content_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolver_id` integer,
	`resolution` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_content_reports_status` ON `content_reports` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_content_reports_target` ON `content_reports` (`target_type`, `target_id`);
--> statement-breakpoint

-- #93: Audit log table
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_action` ON `audit_log` (`action`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_target` ON `audit_log` (`target_type`, `target_id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_actor` ON `audit_log` (`actor_id`);