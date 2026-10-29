CREATE TABLE `challenge_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenge_id` integer NOT NULL,
	`exercise_template_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_exercises_unique` ON `challenge_exercises` (`challenge_id`,`exercise_template_id`);--> statement-breakpoint
CREATE TABLE `challenge_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenge_id` integer NOT NULL,
	`challenge_exercise_id` integer NOT NULL,
	`discord_user_id` text NOT NULL,
	`tier` integer NOT NULL,
	`achieved_at` text NOT NULL,
	`source` text NOT NULL,
	`workout_id` text,
	`value_achieved` real,
	`notes` text,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challenge_exercise_id`) REFERENCES `challenge_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_progress_unique` ON `challenge_progress` (`challenge_id`,`challenge_exercise_id`,`discord_user_id`,`tier`);--> statement-breakpoint
CREATE TABLE `challenge_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenge_id` integer NOT NULL,
	`discord_user_id` text NOT NULL,
	`tier_points` integer DEFAULT 0 NOT NULL,
	`bonus_points` integer DEFAULT 0 NOT NULL,
	`total_points` integer DEFAULT 0 NOT NULL,
	`tiers_hit` integer DEFAULT 0 NOT NULL,
	`score_updated_at` text NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_scores_unique` ON `challenge_scores` (`challenge_id`,`discord_user_id`);--> statement-breakpoint
CREATE TABLE `challenge_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenge_exercise_id` integer NOT NULL,
	`tier` integer NOT NULL,
	`metric` text NOT NULL,
	`target_value` real NOT NULL,
	`target_secondary` real,
	FOREIGN KEY (`challenge_exercise_id`) REFERENCES `challenge_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenge_targets_unique` ON `challenge_targets` (`challenge_exercise_id`,`tier`);--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenges_guild_name` ON `challenges` (`guild_id`,`name`);--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`notify_channel_id` text,
	`challenge_channel_id` text,
	`poll_enabled` integer DEFAULT true NOT NULL,
	`weight_unit` text DEFAULT 'kg' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`hevy_api_key_enc` text NOT NULL,
	`hevy_user_id` text,
	`hevy_username` text,
	`hevy_name` text,
	`weight_unit` text DEFAULT 'kg',
	`last_polled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_links_guild_user` ON `user_links` (`guild_id`,`discord_user_id`);--> statement-breakpoint
CREATE TABLE `workouts_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`hevy_workout_id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`notified` integer DEFAULT false NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_cache_unique` ON `workouts_cache` (`guild_id`,`discord_user_id`,`hevy_workout_id`);--> statement-breakpoint
CREATE INDEX `workouts_cache_user` ON `workouts_cache` (`guild_id`,`discord_user_id`);