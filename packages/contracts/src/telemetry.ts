import type { Harness } from "./types"

export const TELEMETRY_EVENT_NAMES = [
  "dashboard_tab_viewed",
  "agent_spawned",
  "project_created",
  "issue_merged",
  "force_merge_triggered",
  "issue_closed_out",
  "bulk_close_out_initiated",
  "auto_merge_toggled",
  "conversation_forked",
  "plan_approved",
  "plan_changes_requested",
  "agent_question_answered",
  "server_boot",
  "cli_command_run",
  "pipeline_stage_changed",
] as const

export type TelemetryEventName = typeof TELEMETRY_EVENT_NAMES[number]

export type TelemetryCountBucket = "0" | "1-2" | "3-5" | "6-10" | "11+"
export type TelemetryDurationBucket = "under_100ms" | "100ms-999ms" | "1s-9s" | "10s+"
export type TelemetryDecisionSubjectKind = "agent" | "conversation"
export type TelemetryModelFamily = "claude" | "gpt" | "gemini" | "kimi" | "minimax" | "glm" | "mimo" | "other"

export const TELEMETRY_CLI_VERBS = [
  "abort",
  "approve",
  "backlog",
  "backup",
  "clean",
  "context",
  "destroy",
  "dev",
  "diff",
  "doctor",
  "done",
  "down",
  "edit",
  "finalize",
  "fork",
  "handoff",
  "health",
  "init",
  "issues",
  "kill",
  "list",
  "migrate",
  "mode",
  "open",
  "pause",
  "pending",
  "plan",
  "project",
  "projects",
  "recover",
  "reload",
  "reopen",
  "request",
  "reset",
  "restart",
  "restore",
  "resume",
  "review",
  "scope",
  "serve",
  "show",
  "skills",
  "spawn-reviewer",
  "staffing",
  "start",
  "status",
  "strike",
  "sync",
  "sync-main",
  "tell",
  "unarchive-conversation",
  "unpause",
  "untroubled",
  "up",
  "update",
  "validate",
  "wipe",
  "write-sequence",
  "other",
] as const

export type TelemetryCliVerb = typeof TELEMETRY_CLI_VERBS[number]

export type TelemetryDashboardTab =
  | "home"
  | "pipeline"
  | "kanban"
  | "command-deck"
  | "agents"
  | "flywheel"
  | "orders"
  | "backlog"
  | "resources"
  | "knowledge"
  | "skills"
  | "context"
  | "health"
  | "activity"
  | "metrics"
  | "costs"
  | "autopreso"
  | "settings"
  | "god-view"
  | "deacon"
  | "sessions"
  | "awaiting-merge"

export interface DashboardTabViewedProperties {
  readonly tab: TelemetryDashboardTab
}

export interface AgentSpawnedProperties {
  readonly spawn_mode: "spawn-and-send" | "spawn-work-and-send"
  readonly has_message: boolean
}

export interface ProjectCreatedProperties {
  readonly mode: "existing" | "new"
}

export interface IssueMergedProperties {
  readonly merge_kind: "pipeline"
}

export interface ForceMergeTriggeredProperties {
  readonly forge: "github" | "gitlab"
}

export interface IssueClosedOutProperties {
  readonly variant: "card" | "inspector"
}

export interface BulkCloseOutInitiatedProperties {
  readonly issue_count: TelemetryCountBucket
}

export interface AutoMergeToggledProperties {
  readonly auto_merge: boolean
  readonly variant: "segmented" | "badge"
}

export interface ConversationForkedProperties {
  readonly fork_intent: "summary" | "handoff" | "plain"
  readonly fork_mode: "summary" | "handoff" | "plain"
  readonly fast_summary: boolean
  readonly launch_harness: Harness
}

export interface PlanApprovedProperties {
  readonly subject_kind: TelemetryDecisionSubjectKind
}

export interface PlanChangesRequestedProperties {
  readonly subject_kind: TelemetryDecisionSubjectKind
}

export interface AgentQuestionAnsweredProperties {
  readonly subject_kind: TelemetryDecisionSubjectKind
  readonly answer_type: "custom" | "selection"
  readonly question_count: TelemetryCountBucket
}

export interface ServerBootProperties {
  readonly project_count: TelemetryCountBucket
  readonly active_agent_count: TelemetryCountBucket
}

export interface CliCommandRunProperties {
  readonly verb: TelemetryCliVerb
  readonly ok: boolean
  readonly duration_ms: TelemetryDurationBucket
}

export interface PipelineStageChangedProperties {
  readonly stage: "merged" | "verification_passed" | "closed_out"
  readonly harness: Harness
  readonly model: TelemetryModelFamily
}

export interface TelemetryEventProperties {
  readonly dashboard_tab_viewed: DashboardTabViewedProperties
  readonly agent_spawned: AgentSpawnedProperties
  readonly project_created: ProjectCreatedProperties
  readonly issue_merged: IssueMergedProperties
  readonly force_merge_triggered: ForceMergeTriggeredProperties
  readonly issue_closed_out: IssueClosedOutProperties
  readonly bulk_close_out_initiated: BulkCloseOutInitiatedProperties
  readonly auto_merge_toggled: AutoMergeToggledProperties
  readonly conversation_forked: ConversationForkedProperties
  readonly plan_approved: PlanApprovedProperties
  readonly plan_changes_requested: PlanChangesRequestedProperties
  readonly agent_question_answered: AgentQuestionAnsweredProperties
  readonly server_boot: ServerBootProperties
  readonly cli_command_run: CliCommandRunProperties
  readonly pipeline_stage_changed: PipelineStageChangedProperties
}

export type TelemetryPropertiesFor<Event extends TelemetryEventName> = TelemetryEventProperties[Event]
