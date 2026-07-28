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

const TELEMETRY_HARNESSES = ["claude-code", "ohmypi", "codex", "acp", "kimi-code"] as const satisfies readonly Harness[]

export const TELEMETRY_PROPERTY_DOMAINS = {
  agent_spawn_mode: ["spawn-and-send", "spawn-work-and-send"],
  answer_type: ["custom", "selection"],
  auto_merge_variant: ["segmented", "badge"],
  boolean: [false, true],
  cli_verb: TELEMETRY_CLI_VERBS,
  close_out_variant: ["card", "inspector"],
  count_bucket: ["0", "1-2", "3-5", "6-10", "11+"],
  dashboard_tab: [
    "home",
    "pipeline",
    "kanban",
    "command-deck",
    "agents",
    "flywheel",
    "orders",
    "backlog",
    "resources",
    "knowledge",
    "skills",
    "context",
    "health",
    "activity",
    "metrics",
    "costs",
    "autopreso",
    "settings",
    "god-view",
    "deacon",
    "sessions",
    "awaiting-merge",
  ],
  decision_subject: ["agent", "conversation"],
  duration_bucket: ["under_100ms", "100ms-999ms", "1s-9s", "10s+"],
  forge: ["github", "gitlab"],
  fork_kind: ["summary", "handoff", "plain"],
  harness: TELEMETRY_HARNESSES,
  merge_kind: ["pipeline"],
  model_family: ["claude", "gpt", "gemini", "kimi", "minimax", "glm", "mimo", "other"],
  pipeline_stage: ["work_done", "review_passed", "verification_passed", "merged", "closed_out"],
  project_mode: ["existing", "new"],
} as const

export type TelemetryPropertyDomainName = keyof typeof TELEMETRY_PROPERTY_DOMAINS

export const TELEMETRY_EVENT_CATALOG = {
  dashboard_tab_viewed: { tab: "dashboard_tab" },
  agent_spawned: { spawn_mode: "agent_spawn_mode", has_message: "boolean" },
  project_created: { mode: "project_mode" },
  issue_merged: { merge_kind: "merge_kind" },
  force_merge_triggered: { forge: "forge" },
  issue_closed_out: { variant: "close_out_variant" },
  bulk_close_out_initiated: { issue_count: "count_bucket" },
  auto_merge_toggled: { auto_merge: "boolean", variant: "auto_merge_variant" },
  conversation_forked: {
    fork_intent: "fork_kind",
    fork_mode: "fork_kind",
    fast_summary: "boolean",
    launch_harness: "harness",
  },
  plan_approved: { subject_kind: "decision_subject" },
  plan_changes_requested: { subject_kind: "decision_subject" },
  agent_question_answered: {
    subject_kind: "decision_subject",
    answer_type: "answer_type",
    question_count: "count_bucket",
  },
  server_boot: { project_count: "count_bucket", active_agent_count: "count_bucket" },
  cli_command_run: { verb: "cli_verb", ok: "boolean", duration_ms: "duration_bucket" },
  pipeline_stage_changed: { stage: "pipeline_stage", harness: "harness", model: "model_family" },
} as const satisfies Record<TelemetryEventName, Record<string, TelemetryPropertyDomainName>>

type TelemetryPropertyValue<Domain extends TelemetryPropertyDomainName> =
  (typeof TELEMETRY_PROPERTY_DOMAINS)[Domain][number]

type EventProperties<Event extends TelemetryEventName> = {
  readonly [Property in keyof (typeof TELEMETRY_EVENT_CATALOG)[Event]]:
    TelemetryPropertyValue<(typeof TELEMETRY_EVENT_CATALOG)[Event][Property] & TelemetryPropertyDomainName>
}

export type TelemetryCountBucket = TelemetryPropertyValue<"count_bucket">
export type TelemetryDurationBucket = TelemetryPropertyValue<"duration_bucket">
export type TelemetryDecisionSubjectKind = TelemetryPropertyValue<"decision_subject">
export type TelemetryModelFamily = TelemetryPropertyValue<"model_family">
export type TelemetryCliVerb = TelemetryPropertyValue<"cli_verb">
export type TelemetryDashboardTab = TelemetryPropertyValue<"dashboard_tab">

export type DashboardTabViewedProperties = EventProperties<"dashboard_tab_viewed">
export type AgentSpawnedProperties = EventProperties<"agent_spawned">
export type ProjectCreatedProperties = EventProperties<"project_created">
export type IssueMergedProperties = EventProperties<"issue_merged">
export type ForceMergeTriggeredProperties = EventProperties<"force_merge_triggered">
export type IssueClosedOutProperties = EventProperties<"issue_closed_out">
export type BulkCloseOutInitiatedProperties = EventProperties<"bulk_close_out_initiated">
export type AutoMergeToggledProperties = EventProperties<"auto_merge_toggled">
export type ConversationForkedProperties = EventProperties<"conversation_forked">
export type PlanApprovedProperties = EventProperties<"plan_approved">
export type PlanChangesRequestedProperties = EventProperties<"plan_changes_requested">
export type AgentQuestionAnsweredProperties = EventProperties<"agent_question_answered">
export type ServerBootProperties = EventProperties<"server_boot">
export type CliCommandRunProperties = EventProperties<"cli_command_run">
export type PipelineStageChangedProperties = EventProperties<"pipeline_stage_changed">

export type TelemetryEventProperties = {
  readonly [Event in TelemetryEventName]: EventProperties<Event>
}

export type TelemetryPropertiesFor<Event extends TelemetryEventName> = TelemetryEventProperties[Event]
