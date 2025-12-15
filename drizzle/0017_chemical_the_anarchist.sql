CREATE TABLE `batch_task` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain` text NOT NULL,
	`total_count` integer NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `batch_task_user_id_idx` ON `batch_task` (`user_id`);--> statement-breakpoint
CREATE INDEX `batch_task_created_at_idx` ON `batch_task` (`created_at`);