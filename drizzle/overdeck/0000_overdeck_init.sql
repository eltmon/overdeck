CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`workspace` text NOT NULL,
	`session_id` text,
	`harness` text NOT NULL,
	`model` text NOT NULL,
	`host_override` text,
	`delivery_method` text,
	`started_at` integer,
	`last_resume_at` integer,
	`stopped_by_user` integer,
	`stopped_by_pause` integer,
	`kickoff_delivered` integer,
	`paused` integer,
	`paused_reason` text,
	`troubled` integer,
	`channels_enabled` integer,
	`consecutive_failures` integer DEFAULT 0,
	`first_failure_in_run_at` integer,
	`last_failure_next_retry_at` integer,
	`stopped_at` integer,
	`paused_at` integer,
	`troubled_at` integer,
	`last_activity` integer,
	`last_failure_reason` text,
	`phase` text,
	`role_run_head` text,
	`flywheel_run_id` text,
	`cost_so_far` real,
	`review_sub_role` text,
	`review_run_id` text,
	`review_synthesis_agent_id` text,
	`review_output_path` text,
	`review_deadline_at` integer,
	`review_monitor_signaled` text,
	`review_retry_attempt` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_issue_idx` ON `agents` (`issue_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `conversation_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`harness` text NOT NULL,
	`locator` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conv_files_conv_idx` ON `conversation_files` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`issue_id` text,
	`harness` text,
	`model` text,
	`effort` text,
	`title` text,
	`title_source` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	`handoff_doc_path` text,
	`handoff_target_conv_id` text,
	`cleared_to_conv_id` text,
	`tmux_session` text,
	`status` text NOT NULL DEFAULT 'active',
	`ended_at` integer,
	`last_attached_at` integer,
	`session_file` text,
	`total_cost` real DEFAULT 0,
	`total_tokens` integer DEFAULT 0,
	`fork_status` text,
	`fork_error` text,
	`fork_retry_count` integer NOT NULL DEFAULT 0,
	`fork_request` text,
	`fork_fallback_reason` text,
	`delivery_method` text,
	`spawn_error` text,
	FOREIGN KEY (`handoff_target_conv_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cleared_to_conv_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_name_unique` ON `conversations` (`name`);--> statement-breakpoint
CREATE INDEX `conversations_issue_idx` ON `conversations` (`issue_id`);--> statement-breakpoint
CREATE TABLE `cost_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`issue_id` text,
	`agent_id` text,
	`session_id` text,
	`session_type` text,
	`provider` text,
	`model` text,
	`input` integer,
	`output` integer,
	`cache_read` integer,
	`cache_write` integer,
	`cost` real,
	`request_id` text,
	`source_file` text
);
--> statement-breakpoint
CREATE INDEX `cost_issue_idx` ON `cost_events` (`issue_id`);--> statement-breakpoint
CREATE INDEX `cost_ts_idx` ON `cost_events` (`ts`);--> statement-breakpoint
CREATE INDEX `cost_session_id_idx` ON `cost_events` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_request_id_idx` ON `cost_events` (`request_id`) WHERE request_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`timestamp` integer NOT NULL,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `events_type_ts_idx` ON `events` (`type`,`timestamp`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`type` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`type`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `health_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text,
	`timestamp` integer NOT NULL,
	`state` text NOT NULL,
	`source` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `health_agent_ts_idx` ON `health_events` (`agent_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `issue_policy` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`deacon_ignored` integer,
	`deacon_ignored_reason` text,
	`auto_merge` integer,
	`updated_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`review_outcome` text,
	`test_outcome` text,
	`verification_outcome` text,
	`verdict_commit` text,
	`blockers` text,
	`plan_ref` text,
	`pr_url` text,
	`pr_number` integer,
	`pr_head_sha` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issues_stage_idx` ON `issues` (`stage`);--> statement-breakpoint
CREATE TABLE `merge_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_key` text NOT NULL,
	`issue_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merge_queue_issue_id_unique` ON `merge_queue` (`issue_id`);--> statement-breakpoint
CREATE INDEX `merge_queue_project_idx` ON `merge_queue` (`project_key`,`position`);--> statement-breakpoint
CREATE TABLE `merge_set_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`repo_key` text NOT NULL,
	`repo_path` text NOT NULL,
	`forge` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`artifact_url` text,
	`artifact_id` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`test_status` text DEFAULT 'pending' NOT NULL,
	`rebase_status` text DEFAULT 'pending' NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`merge_status` text DEFAULT 'pending' NOT NULL,
	`merge_order` integer DEFAULT 0 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `merge_sets`(`issue_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merge_set_repos_issue_idx` ON `merge_set_repos` (`issue_id`);--> statement-breakpoint
CREATE TABLE `merge_sets` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`project_path` text NOT NULL,
	`workspace_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merge_sets_project_idx` ON `merge_sets` (`project_key`,`updated_at`);--> statement-breakpoint
CREATE TABLE `pending_auto_merges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`pr_url` text NOT NULL,
	`project_key` text NOT NULL,
	`forge` text DEFAULT 'github' NOT NULL,
	`status` text NOT NULL,
	`scheduled_merge_at` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`merged_at` integer,
	`failure_reason` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pending_auto_merges_issue_idx` ON `pending_auto_merges` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_auto_merges_active_issue_idx` ON `pending_auto_merges` (`issue_id`) WHERE status IN ('pending','merging');--> statement-breakpoint
CREATE TABLE `review_run_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text,
	`sub_role` text,
	`output_path` text,
	`deadline_at` integer,
	`monitor_signaled` text,
	`retry_attempt` integer,
	FOREIGN KEY (`run_id`) REFERENCES `review_runs`(`run_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_run_agents_run_idx` ON `review_run_agents` (`run_id`);--> statement-breakpoint
CREATE TABLE `review_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`review_synthesis_agent_id` text,
	`verification_cycle_count` integer DEFAULT 0,
	`auto_requeue_count` integer DEFAULT 0,
	`merge_retry_count` integer DEFAULT 0,
	`test_retry_count` integer DEFAULT 0,
	`review_retry_count` integer DEFAULT 0,
	`stuck` integer DEFAULT false NOT NULL,
	`stuck_reason` text,
	`review_spawned_at` integer,
	`conflict_resolution_dispatched_at` integer,
	`recovery_started_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_runs_issue_idx` ON `review_runs` (`issue_id`);--> statement-breakpoint
CREATE TABLE `review_status` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`test_status` text DEFAULT 'pending' NOT NULL,
	`merge_status` text,
	`inspect_status` text,
	`inspect_notes` text,
	`inspect_started_at` integer,
	`inspect_bead_id` text,
	`verification_status` text,
	`verification_notes` text,
	`verification_cycle_count` integer DEFAULT 0,
	`verification_max_cycles` integer,
	`review_notes` text,
	`test_notes` text,
	`merge_notes` text,
	`updated_at` integer NOT NULL,
	`ready_for_merge` integer DEFAULT 0 NOT NULL,
	`auto_requeue_count` integer DEFAULT 0,
	`merge_retry_count` integer DEFAULT 0,
	`pr_url` text,
	`pr_head_sha` text,
	`pr_number` integer,
	`stuck` integer DEFAULT 0 NOT NULL,
	`stuck_reason` text,
	`stuck_at` integer,
	`stuck_details` text,
	`reviewed_at_commit` text,
	`review_spawned_at` integer,
	`conflict_resolution_dispatched_at` integer,
	`test_retry_count` integer DEFAULT 0,
	`review_retry_count` integer DEFAULT 0,
	`recovery_started_at` integer,
	`deacon_ignored` integer DEFAULT 0 NOT NULL,
	`deacon_ignored_at` integer,
	`deacon_ignored_reason` text,
	`blocker_reasons` text,
	`last_verified_commit` text,
	`merge_step` text,
	`auto_merge` integer
);
--> statement-breakpoint
CREATE INDEX `review_status_updated_idx` ON `review_status` (`updated_at`);--> statement-breakpoint
CREATE TABLE `status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`timestamp` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `status_history_issue_idx` ON `status_history` (`issue_id`,`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `status_history_unique_idx` ON `status_history` (`issue_id`,`type`,`status`,`timestamp`);--> statement-breakpoint
CREATE TABLE `transcript_checkpoints` (
	`session_id` text PRIMARY KEY NOT NULL,
	`transcript_path` text NOT NULL,
	`last_offset` integer DEFAULT 0 NOT NULL,
	`claim_owner` text,
	`claim_from` integer,
	`claim_to` integer,
	`claim_expires_at` integer,
	`mid_turn_count_in_current_turn` integer DEFAULT 0,
	`last_mid_turn_at` integer,
	`project_id` text,
	`workspace_id` text,
	`issue_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`backing_file_path` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`harness` text,
	`workspace_path` text,
	`message_count` integer,
	`models` text,
	`token_input` integer,
	`token_output` integer,
	`first_ts` integer,
	`last_ts` integer,
	`pan_issue_id` text,
	`pan_agent_id` text,
	`file_mtime` integer,
	`scanned_at` integer
);
--> statement-breakpoint
CREATE TABLE `uat_generation_members` (
	`uat_name` text NOT NULL,
	`issue_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`title` text,
	`branch` text,
	`head_sha` text,
	`merge_order` integer,
	`pr` integer,
	`pr_url` text,
	`reason` text,
	PRIMARY KEY(`uat_name`, `issue_id`),
	FOREIGN KEY (`uat_name`) REFERENCES `uat_generations`(`name`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `uat_generation_resolutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uat_name` text NOT NULL,
	`issue_ids` text NOT NULL,
	`files` text NOT NULL,
	`commit_sha` text NOT NULL,
	FOREIGN KEY (`uat_name`) REFERENCES `uat_generations`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uat_resolutions_uat_idx` ON `uat_generation_resolutions` (`uat_name`);--> statement-breakpoint
CREATE TABLE `uat_generations` (
	`name` text PRIMARY KEY NOT NULL,
	`worktree_path` text NOT NULL,
	`project_root` text NOT NULL,
	`base_sha` text NOT NULL,
	`status` text DEFAULT 'assembling' NOT NULL,
	`stack_started_at` integer,
	`cleaned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uat_status_idx` ON `uat_generations` (`status`);--> statement-breakpoint
CREATE TABLE `discovered_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jsonl_path` text NOT NULL UNIQUE,
	`session_id` text,
	`workspace_path` text,
	`workspace_hash` text,
	`message_count` integer NOT NULL DEFAULT 0,
	`first_ts` integer,
	`last_ts` integer,
	`models_used` text,
	`primary_model` text,
	`token_input` integer NOT NULL DEFAULT 0,
	`token_output` integer NOT NULL DEFAULT 0,
	`estimated_cost` real NOT NULL DEFAULT 0,
	`tools_used` text,
	`files_touched` text,
	`tags` text,
	`summary` text,
	`summary_detailed` text,
	`enrichment_level` integer NOT NULL DEFAULT 0,
	`enrichment_model` text,
	`enriched_at` integer,
	`enrichment_failed` integer NOT NULL DEFAULT 0,
	`overdeck_managed` integer NOT NULL DEFAULT 0,
	`pan_issue_id` text,
	`pan_agent_id` text,
	`file_size` integer,
	`file_mtime` integer,
	`scanned_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_discovered_workspace` ON `discovered_sessions` (`workspace_path`);--> statement-breakpoint
CREATE INDEX `idx_discovered_last_ts` ON `discovered_sessions` (`last_ts`);--> statement-breakpoint
CREATE INDEX `idx_discovered_enrichment` ON `discovered_sessions` (`enrichment_level`,`enriched_at`);--> statement-breakpoint
CREATE INDEX `idx_discovered_managed` ON `discovered_sessions` (`overdeck_managed`,`pan_issue_id`);--> statement-breakpoint
CREATE INDEX `idx_discovered_model` ON `discovered_sessions` (`primary_model`);--> statement-breakpoint
CREATE INDEX `idx_discovered_session_id` ON `discovered_sessions` (`session_id`) WHERE session_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `discovered_session_tags` (
	`session_id` integer NOT NULL REFERENCES `discovered_sessions`(`id`) ON DELETE CASCADE,
	`tag` text NOT NULL,
	PRIMARY KEY (`session_id`, `tag`)
);--> statement-breakpoint
CREATE INDEX `idx_discovered_session_tags_tag` ON `discovered_session_tags` (`tag`,`session_id`);--> statement-breakpoint
CREATE TABLE `discovered_session_tools` (
	`session_id` integer NOT NULL REFERENCES `discovered_sessions`(`id`) ON DELETE CASCADE,
	`tool` text NOT NULL,
	PRIMARY KEY (`session_id`, `tool`)
);--> statement-breakpoint
CREATE INDEX `idx_discovered_session_tools_tool` ON `discovered_session_tools` (`tool`,`session_id`);--> statement-breakpoint
CREATE TABLE `discovered_session_files` (
	`session_id` integer NOT NULL REFERENCES `discovered_sessions`(`id`) ON DELETE CASCADE,
	`file_path` text NOT NULL,
	PRIMARY KEY (`session_id`, `file_path`)
);--> statement-breakpoint
CREATE INDEX `idx_discovered_session_files_file_path` ON `discovered_session_files` (`file_path`,`session_id`);--> statement-breakpoint
CREATE TABLE `session_embeddings` (
	`session_id` integer NOT NULL REFERENCES `discovered_sessions`(`id`) ON DELETE CASCADE,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`session_id`, `model`)
);--> statement-breakpoint
CREATE TABLE `git_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`branch` text,
	`issue_id` text,
	`before_sha` text,
	`after_sha` text,
	`remote_sha` text,
	`status` text NOT NULL,
	`error` text,
	`ts` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_git_ops_ts` ON `git_operations` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_git_ops_issue` ON `git_operations` (`issue_id`,`ts`);--> statement-breakpoint
CREATE TABLE `flywheel_substrate_bugs` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`filed_at` integer NOT NULL,
	`run_id` text,
	`filed_by` text NOT NULL,
	`discovered_in_issue_id` text,
	`severity` text NOT NULL DEFAULT 'P2',
	`status` text NOT NULL DEFAULT 'open',
	`fix_merged_at` integer,
	`fix_commit_sha` text,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_fsb_filed_at` ON `flywheel_substrate_bugs` (`filed_at`);--> statement-breakpoint
CREATE INDEX `idx_fsb_status` ON `flywheel_substrate_bugs` (`status`);--> statement-breakpoint
