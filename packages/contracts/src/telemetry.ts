import type { ROUTE_KINDS } from "./machines"
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
  "machine_link_started",
  "machine_link_approved",
  "machine_link_failed",
  "phone_paired",
  "phone_removed",
  "anywhere_channel_opened",
  "relay_usage_sampled",
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
  "pr_adoption",
  "other",
] as const

/** PAN-5016: route kinds (ROUTE_KINDS in ./machines) plus `stored`, the stored-route probe phase. */
const TELEMETRY_CHANNEL_ROUTES = ["lan", "tailnet", "ssh", "public", "direct", "relay", "stored"] as const satisfies readonly ((typeof ROUTE_KINDS)[number] | "stored")[]

export const TELEMETRY_PROPERTY_DOMAINS = {
  agent_spawn_mode: ["spawn-and-send", "spawn-work-and-send"],
  answer_type: ["custom", "selection", "note", "selection+note"],
  auto_merge_variant: ["segmented", "badge"],
  boolean: [false, true],
  channel_error_class: ["none", "unreachable", "identity_refused", "unknown_peer", "unsupported", "no_relay_plan", "descriptor_failed", "wrong_machine", "heartbeat_failed", "revoked"],
  channel_route: TELEMETRY_CHANNEL_ROUTES,
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
  link_failure_reason: ["bad_pairing_url", "unreachable", "pairing_refused", "unsupported", "identity_mismatch", "exchange_failed", "grant_refused", "offline", "approval_refused", "approval_failed", "other"],
  link_method: ["pairing_code", "ssh", "fly", "directory_approval", "other"],
  link_side: ["requester", "approver"],
  merge_kind: ["pipeline"],
  model_family: ["claude", "gpt", "gemini", "kimi", "minimax", "glm", "mimo", "other"],
  phone_removed_by: ["operator", "phone"],
  pipeline_stage: ["work_done", "review_passed", "verification_passed", "merged", "closed_out"],
  // "clone" ships with PAN-3836; without it the dimension cannot show whether
  // cloning is actually used, which is the reason the event carries a mode.
  project_mode: ["clone", "existing", "new"],
  quota_points_bucket: ["0", "1-49", "50-199", "200-499", "500-999", "1000-2499", "2500+"],
  quota_remaining_bucket: ["0", "1-99", "100-499", "500-999", "1000-2499", "2500+", "unknown"],
  rate_limit_kind: ["primary", "secondary"],
  relay_bytes_bucket: ["under_1mb", "1mb-9mb", "10mb-99mb", "100mb-999mb", "1gb+"],
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
    fresh_start: "boolean",
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
  machine_link_started: { method: "link_method" },
  machine_link_approved: { method: "link_method", side: "link_side" },
  machine_link_failed: { method: "link_method", side: "link_side", reason: "link_failure_reason" },
  phone_paired: { replaced_previous: "boolean" },
  phone_removed: { by: "phone_removed_by" },
  anywhere_channel_opened: { route: "channel_route", ok: "boolean", error_class: "channel_error_class" },
  relay_usage_sampled: { bytes: "relay_bytes_bucket" },
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
export type MachineLinkStartedProperties = EventProperties<"machine_link_started">
export type MachineLinkApprovedProperties = EventProperties<"machine_link_approved">
export type MachineLinkFailedProperties = EventProperties<"machine_link_failed">
export type PhonePairedProperties = EventProperties<"phone_paired">
export type PhoneRemovedProperties = EventProperties<"phone_removed">
export type AnywhereChannelOpenedProperties = EventProperties<"anywhere_channel_opened">
export type RelayUsageSampledProperties = EventProperties<"relay_usage_sampled">
export type TelemetryQuotaPointsBucket = TelemetryPropertyValue<"quota_points_bucket">
export type TelemetryQuotaRemainingBucket = TelemetryPropertyValue<"quota_remaining_bucket">
export type TelemetryGitHubCaller = TelemetryPropertyValue<"github_caller">
export type TelemetryLinkMethod = TelemetryPropertyValue<"link_method">
export type TelemetryLinkSide = TelemetryPropertyValue<"link_side">
export type TelemetryLinkFailureReason = TelemetryPropertyValue<"link_failure_reason">
export type TelemetryChannelRoute = TelemetryPropertyValue<"channel_route">
export type TelemetryChannelErrorClass = TelemetryPropertyValue<"channel_error_class">
export type TelemetryRelayBytesBucket = TelemetryPropertyValue<"relay_bytes_bucket">

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

/** PAN-5016: relayed bytes as a coarse bucket (raw byte counts are never sent). */
export function bucketRelayBytes(bytes: number): TelemetryRelayBytesBucket {
  if (!(bytes >= 1_000_000)) return "under_1mb"
  if (bytes < 10_000_000) return "1mb-9mb"
  if (bytes < 100_000_000) return "10mb-99mb"
  if (bytes < 1_000_000_000) return "100mb-999mb"
  return "1gb+"
}

export type TelemetryEventProperties = {
  readonly [Event in TelemetryEventName]: EventProperties<Event>
}

export type TelemetryPropertiesFor<Event extends TelemetryEventName> = TelemetryEventProperties[Event]
