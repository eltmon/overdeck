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
  "github_quota_sample",
  "github_rate_limited",
  "instance_heartbeat",
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

const TELEMETRY_HARNESSES = ["claude-code", "ohmypi", "codex", "acp", "kimi-code", "opencode", "muse", "prime-agent"] as const satisfies readonly Harness[]

/**
 * PAN-4264: GitHub quota callers as telemetry values (`-` → `_`). Mirrors
 * `GITHUB_QUOTA_CALLERS` in ./github-quota; a unit test keeps them in step.
 */
const TELEMETRY_GITHUB_CALLERS = [
  "pipeline_membership",
  "pr_cache",
  "pr_sync",
  "ci_repair",
  "issue_poller",
  "close_out",
  "tracker_client",
  "app_rest",
  "quota_sampler",
  "agent",
  "other",
] as const

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
    "workspace-new",
    "project-new",
    "workspace",
  ],
  decision_subject: ["agent", "conversation"],
  duration_bucket: ["under_100ms", "100ms-999ms", "1s-9s", "10s+"],
  forge: ["github", "gitlab"],
  fork_kind: ["summary", "handoff", "plain"],
  github_caller: TELEMETRY_GITHUB_CALLERS,
  harness: TELEMETRY_HARNESSES,
  merge_kind: ["pipeline"],
  model_family: ["claude", "gpt", "gemini", "kimi", "minimax", "glm", "mimo", "other"],
  pipeline_stage: ["work_done", "review_passed", "verification_passed", "merged", "closed_out"],
  // "clone" ships with PAN-3836; without it the dimension cannot show whether
  // cloning is actually used, which is the reason the event carries a mode.
  project_mode: ["clone", "existing", "new"],
  quota_points_bucket: ["0", "1-49", "50-199", "200-499", "500-999", "1000-2499", "2500+"],
  quota_remaining_bucket: ["0", "1-99", "100-499", "500-999", "1000-2499", "2500+", "unknown"],
  rate_limit_kind: ["primary", "secondary"],
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
  github_quota_sample: {
    graphql_pipeline_membership: "quota_points_bucket",
    rest_pipeline_membership: "quota_points_bucket",
    graphql_pr_cache: "quota_points_bucket",
    rest_pr_cache: "quota_points_bucket",
    graphql_pr_sync: "quota_points_bucket",
    rest_pr_sync: "quota_points_bucket",
    graphql_ci_repair: "quota_points_bucket",
    rest_ci_repair: "quota_points_bucket",
    graphql_issue_poller: "quota_points_bucket",
    rest_issue_poller: "quota_points_bucket",
    graphql_close_out: "quota_points_bucket",
    rest_close_out: "quota_points_bucket",
    graphql_tracker_client: "quota_points_bucket",
    rest_tracker_client: "quota_points_bucket",
    graphql_app_rest: "quota_points_bucket",
    rest_app_rest: "quota_points_bucket",
    graphql_agent: "quota_points_bucket",
    rest_agent: "quota_points_bucket",
    graphql_other: "quota_points_bucket",
    rest_other: "quota_points_bucket",
    graphql_unattributed: "quota_points_bucket",
    min_remaining_graphql: "quota_remaining_bucket",
    min_remaining_rest: "quota_remaining_bucket",
    primary_limit_errors: "count_bucket",
    secondary_limit_errors: "count_bucket",
  },
  github_rate_limited: { caller: "github_caller", kind: "rate_limit_kind", own_usage_low: "boolean" },
  instance_heartbeat: { project_count: "count_bucket", active_agent_count: "count_bucket", dashboard_running: "boolean" },
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
export type GitHubQuotaSampleProperties = EventProperties<"github_quota_sample">
export type GitHubRateLimitedProperties = EventProperties<"github_rate_limited">
export type InstanceHeartbeatProperties = EventProperties<"instance_heartbeat">
export type TelemetryQuotaPointsBucket = TelemetryPropertyValue<"quota_points_bucket">
export type TelemetryQuotaRemainingBucket = TelemetryPropertyValue<"quota_remaining_bucket">
export type TelemetryGitHubCaller = TelemetryPropertyValue<"github_caller">

/** PAN-4264: GitHub quota points as a coarse bucket (raw counts are never sent). */
export function bucketQuotaPoints(points: number): TelemetryQuotaPointsBucket {
  if (!(points > 0)) return "0"
  if (points < 50) return "1-49"
  if (points < 200) return "50-199"
  if (points < 500) return "200-499"
  if (points < 1000) return "500-999"
  if (points < 2500) return "1000-2499"
  return "2500+"
}

/** PAN-4264: GitHub quota remaining as a coarse bucket; `unknown` without a sample. */
export function bucketQuotaRemaining(remaining: number | undefined): TelemetryQuotaRemainingBucket {
  if (remaining === undefined || !Number.isFinite(remaining)) return "unknown"
  if (remaining <= 0) return "0"
  if (remaining < 100) return "1-99"
  if (remaining < 500) return "100-499"
  if (remaining < 1000) return "500-999"
  if (remaining < 2500) return "1000-2499"
  return "2500+"
}

export type TelemetryEventProperties = {
  readonly [Event in TelemetryEventName]: EventProperties<Event>
}

export type TelemetryPropertiesFor<Event extends TelemetryEventName> = TelemetryEventProperties[Event]
