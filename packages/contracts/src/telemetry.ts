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
  "mcp_session_seen",
  "mcp_tool_called",
  "client_request_failed",
  "phone_link_state",
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

const TELEMETRY_HARNESSES = ["claude-code", "pi", "ohmypi", "codex", "acp", "kimi-code", "opencode", "muse", "prime-agent", "grok"] as const satisfies readonly Harness[]

/** PAN-5084: what kind of install reported an event — distinguishes real adoption from CI/test/VM churn. */
export const TELEMETRY_INSTALL_KINDS = ["user", "remote_vm", "dev_checkout", "container"] as const

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

/** PAN-5083: the Overdeck MCP tool names (ALL_TOOLS in src/lib/mcp/server.ts); a unit test keeps them in step. */
const TELEMETRY_MCP_TOOLS = [
  "answer_agent_permission",
  "answer_agent_plan",
  "answer_codex_approval",
  "answer_pane_choice",
  "answer_permission",
  "answer_pi_ask",
  "answer_plan",
  "answer_question",
  "delegate_task",
  "delete_scheduled",
  "done",
  "handoff",
  "interrupt_conversation",
  "lane_report",
  "lane_start",
  "lane_status",
  "lane_stop",
  "lane_wait",
  "link_machine",
  "link_machine_wait",
  "link_pull_request",
  "list_conversations",
  "list_machines",
  "list_pending_input",
  "list_pull_request_watches",
  "list_scheduled",
  "list_workers",
  "memory_add",
  "memory_search",
  "read_conversation",
  "request_secret",
  "resume_conversation",
  "schedule_message",
  "schedule_recurring",
  "search_conversations",
  "secret_wait",
  "send_message",
  "start_conversation",
  "start_issue",
  "start_worker",
  "stop_conversation",
  "task_block",
  "task_cancel",
  "task_claim",
  "task_done",
  "task_status",
  "task_wait",
  "unwatch_pull_request",
  "update_scheduled",
  "wait_job",
  "watch_pull_request",
  "worker_report",
] as const

/**
 * PAN-5100: every `ROUTE_SCOPES` path (`src/dashboard/server/route-scopes.ts`),
 * sorted, then `other`. Literal so the type stays a closed union; regenerate with:
 *   grep -oE "path: '[^']*'" src/dashboard/server/route-scopes.ts | sed "s/path: '//; s/'//" | { cat; echo /api/telemetry/client-config; } | LC_ALL=C sort -u
 */
const TELEMETRY_CLIENT_ROUTES = [
  "/api/activity",
  "/api/agent-directory",
  "/api/agent-requests",
  "/api/agents",
  "/api/agents/:id/answer-question",
  "/api/agents/:id/message",
  "/api/agents/:id/permissions/:requestId/respond",
  "/api/agents/:id/plan-action",
  "/api/agents/:id/tell",
  "/api/backend-restart-recovery",
  "/api/backend-restart-recovery/dismiss",
  "/api/backend-restart-recovery/resume-all",
  "/api/connectors/self",
  "/api/conversations",
  "/api/conversations/:id",
  "/api/conversations/:id/codex-approval",
  "/api/conversations/:id/pane-choice",
  "/api/conversations/:id/permission",
  "/api/conversations/:id/pi-ask-answer",
  "/api/conversations/:name/abort",
  "/api/conversations/:name/about",
  "/api/conversations/:name/attachments/:file",
  "/api/conversations/:name/bookmarks",
  "/api/conversations/:name/compact",
  "/api/conversations/:name/delete-image",
  "/api/conversations/:name/diffs",
  "/api/conversations/:name/diffs/:turnId",
  "/api/conversations/:name/kickoff",
  "/api/conversations/:name/message",
  "/api/conversations/:name/message-locator",
  "/api/conversations/:name/messages",
  "/api/conversations/:name/plan-action",
  "/api/conversations/:name/preview-ports",
  "/api/conversations/:name/pull-requests",
  "/api/conversations/:name/pull-requests/sync",
  "/api/conversations/:name/release",
  "/api/conversations/:name/release/complete",
  "/api/conversations/:name/release/transfer/:transferId",
  "/api/conversations/:name/release/undo",
  "/api/conversations/:name/resume",
  "/api/conversations/:name/scheduled-messages",
  "/api/conversations/:name/scheduled-messages/:id",
  "/api/conversations/:name/schedules",
  "/api/conversations/:name/schedules/:id",
  "/api/conversations/:name/stop",
  "/api/conversations/:name/switch-model",
  "/api/conversations/:name/thinking-level",
  "/api/conversations/:name/tool-body/:toolUseId",
  "/api/conversations/:name/upload-image",
  "/api/conversations/pending-input",
  "/api/costs/request-digest",
  "/api/costs/summary",
  "/api/disk-alert",
  "/api/explorer/download",
  "/api/explorer/upload",
  "/api/fleet/conversations",
  "/api/fleet/issues/:id/activity",
  "/api/fleet/issues/:id/start",
  "/api/fleet/machines",
  "/api/fleet/needs-you",
  "/api/fleet/placement",
  "/api/fleet/search",
  "/api/fleet/workers",
  "/api/fleet/workers/:id/stop",
  "/api/flywheel/status",
  "/api/github/identities",
  "/api/harness-auto-update",
  "/api/issues",
  "/api/issues/:id",
  "/api/issues/resource-allocated",
  "/api/lanes",
  "/api/lanes/:name",
  "/api/lanes/:name/stop",
  "/api/machines/conversations",
  "/api/machines/heartbeat",
  "/api/machines/issue-activity",
  "/api/machines/needs-you",
  "/api/machines/projects",
  "/api/machines/projects/:key/file",
  "/api/machines/projects/:key/source",
  "/api/machines/self",
  "/api/machines/work/conversations",
  "/api/machines/work/issues/:id/start",
  "/api/machines/work/lanes",
  "/api/machines/work/lanes/:name/reap",
  "/api/machines/work/lanes/:name/status",
  "/api/machines/work/projects",
  "/api/machines/work/projects/:jobId",
  "/api/machines/work/workers",
  "/api/needs-you",
  "/api/palette/search",
  "/api/phones/self",
  "/api/phones/self/notification-preferences",
  "/api/phones/self/push-key",
  "/api/pipeline/membership",
  "/api/pull-requests",
  "/api/pull-requests/conversations",
  "/api/push/history",
  "/api/registered-projects",
  "/api/self/done",
  "/api/self/handoff",
  "/api/self/jobs/:id",
  "/api/self/jobs/:id/wait",
  "/api/self/lanes",
  "/api/self/lanes/report",
  "/api/self/lanes/wait",
  "/api/self/machine-link-requests",
  "/api/self/machine-link-requests/:id/wait",
  "/api/self/memory/facts",
  "/api/self/memory/search",
  "/api/self/pull-request-watches",
  "/api/self/pull-request-watches/:id",
  "/api/self/pull-requests",
  "/api/self/secret-requests",
  "/api/self/secret-requests/:id/wait",
  "/api/self/tasks/block",
  "/api/self/tasks/claim",
  "/api/self/tasks/done",
  "/api/self/worker-report",
  "/api/self/workers",
  "/api/self/workers/:id",
  "/api/self/workers/:id/wait",
  "/api/settings/resolved",
  "/api/telemetry/client-config",
  "/api/versions/self",
  "/api/versions/self/update",
  "/api/workers",
  "/api/workers/:id/status",
  "/api/workers/:id/stop",
  "/events/stream",
  "/events/version",
  "other",
] as const

/**
 * PAN-5100: the distinct first segments after `/api/` of every `NO_LOSS_MATRIX`
 * HTTP surface whose disposition is not `DELETE` (`tests/unit/lib/overdeck/no-loss-matrix.ts`),
 * plus `events` and `telemetry`, sorted, then `other`.
 */
const TELEMETRY_CLIENT_ROUTE_AREAS = [
  "access-tokens",
  "account",
  "activity",
  "admin",
  "agent-directory",
  "agent-requests",
  "agents",
  "anywhere",
  "artifacts",
  "autopreso",
  "backend-restart-recovery",
  "backlog",
  "boot-reconciliation",
  "cache",
  "cache-status",
  "claude-code",
  "cliproxy",
  "cloister",
  "color-themes",
  "command-deck",
  "commands",
  "confirmations",
  "connectors",
  "context",
  "conversations",
  "costs",
  "dashboard",
  "deacon",
  "deft",
  "deploy",
  "dev",
  "devices",
  "diffs",
  "directory",
  "discovered-sessions",
  "disk-alert",
  "effort",
  "environment",
  "events",
  "explorer",
  "fleet",
  "flywheel",
  "fs",
  "git-activity",
  "github",
  "github-quota",
  "godview",
  "harness-auto-update",
  "health",
  "hooks",
  "internal",
  "issues",
  "jev",
  "joins",
  "knowledge-viewer",
  "lanes",
  "linear-mcp-auth",
  "linked-conversations",
  "machines",
  "mcp",
  "mcp-oauth",
  "memory",
  "merge-queue",
  "merge-train",
  "metrics",
  "model-presets",
  "models",
  "needs-you",
  "no-resume-mode",
  "orders",
  "pairing",
  "palette",
  "parked",
  "phones",
  "pipeline",
  "planning",
  "prereqs",
  "project-mappings",
  "projects",
  "pull-requests",
  "push",
  "rally",
  "registered-projects",
  "registry",
  "remote",
  "resources",
  "restart-gate",
  "resume-all",
  "review",
  "self",
  "session-trees",
  "settings",
  "shadow",
  "share-probe",
  "shares",
  "show",
  "skills",
  "specialists",
  "system",
  "tailscale",
  "telemetry",
  "terminals",
  "tiered",
  "tracker-status",
  "trackers",
  "triggers",
  "tts",
  "update",
  "vault",
  "velocity",
  "version",
  "versions",
  "voice",
  "webhooks",
  "workers",
  "workspace-registry",
  "workspace-stack-health",
  "workspaces",
  "other",
] as const

export const TELEMETRY_PROPERTY_DOMAINS = {
  agent_spawn_mode: ["spawn-and-send", "spawn-work-and-send"],
  answer_type: ["custom", "selection", "note", "selection+note"],
  auto_merge_variant: ["segmented", "badge"],
  boolean: [false, true],
  channel_error_class: ["none", "unreachable", "identity_refused", "unknown_peer", "unsupported", "no_relay_plan", "descriptor_failed", "wrong_machine", "heartbeat_failed", "revoked"],
  channel_route: TELEMETRY_CHANNEL_ROUTES,
  cli_verb: TELEMETRY_CLI_VERBS,
  client_route: TELEMETRY_CLIENT_ROUTES,          // every ROUTE_SCOPES path, sorted, then "other"
  client_route_area: TELEMETRY_CLIENT_ROUTE_AREAS, // sorted areas (D-7), then "other"
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
  http_method: ["GET", "POST", "PUT", "PATCH", "DELETE", "other"],
  install_kind: TELEMETRY_INSTALL_KINDS,
  link_failure_reason: ["bad_pairing_url", "unreachable", "pairing_refused", "unsupported", "identity_mismatch", "exchange_failed", "grant_refused", "offline", "approval_refused", "approval_failed", "other"],
  link_method: ["pairing_code", "ssh", "fly", "directory_approval", "other"],
  link_reason: ["none", "offline", "no_path", "unreachable", "removed", "pairing_refused", "identity_mismatch", "unsupported", "channel_failed", "delayed", "restarting", "unauthorized", "resume", "other"],
  link_route: ["direct", "relay", "unknown"],
  link_side: ["requester", "approver"],
  link_state: ["failed", "dropped", "recovered", "route_changed"],
  mcp_auth: ["agent_token", "oauth", "access_token", "connector"],
  mcp_client: ["claude_code", "codex", "cursor", "vscode", "chatgpt", "grok", "hermes", "openclaw", "gemini", "opencode", "kimi", "overdeck_connector", "other"],
  mcp_protocol: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07", "other"],
  mcp_surface: ["dashboard_http", "public_http", "stdio", "connector_http", "connector_stdio"],
  mcp_tool: TELEMETRY_MCP_TOOLS,
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
  recovery_bucket: ["none", "under_1s", "1s-4s", "5s-14s", "15s-59s", "60s+"],
  relay_bytes_bucket: ["under_1mb", "1mb-9mb", "10mb-99mb", "100mb-999mb", "1gb+"],
  request_status: ["400", "401", "403", "404", "408", "409", "413", "422", "429", "other_4xx", "500", "502", "503", "504", "other_5xx", "network", "timeout", "aborted"],
  telemetry_client: ["phone", "desktop"],
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
  mcp_session_seen: { mcp_surface: "mcp_surface", mcp_protocol: "mcp_protocol", mcp_client: "mcp_client", mcp_auth: "mcp_auth" },
  mcp_tool_called: { mcp_surface: "mcp_surface", mcp_client: "mcp_client", mcp_tool: "mcp_tool" },
  client_request_failed: { client: "telemetry_client", route: "client_route", route_area: "client_route_area", method: "http_method", status: "request_status" },
  phone_link_state: { state: "link_state", reason: "link_reason", route: "link_route", recover_time: "recovery_bucket" },
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
export type McpSessionSeenProperties = EventProperties<"mcp_session_seen">
export type McpToolCalledProperties = EventProperties<"mcp_tool_called">
export type TelemetryClient = TelemetryPropertyValue<"telemetry_client">
export type TelemetryClientRoute = TelemetryPropertyValue<"client_route">
export type TelemetryClientRouteArea = TelemetryPropertyValue<"client_route_area">
export type TelemetryHttpMethod = TelemetryPropertyValue<"http_method">
export type TelemetryRequestStatus = TelemetryPropertyValue<"request_status">
export type TelemetryLinkState = TelemetryPropertyValue<"link_state">
export type TelemetryLinkReason = TelemetryPropertyValue<"link_reason">
export type TelemetryLinkRoute = TelemetryPropertyValue<"link_route">
export type TelemetryRecoveryBucket = TelemetryPropertyValue<"recovery_bucket">
export type ClientRequestFailedProperties = EventProperties<"client_request_failed">
export type PhoneLinkStateProperties = EventProperties<"phone_link_state">

/** PAN-5100: what `GET /api/telemetry/client-config` returns (D-10..D-12). */
export interface TelemetryClientConfig {
  readonly effectiveEnabled: boolean
  readonly installId?: string
  readonly installKind?: TelemetryInstallKind
  readonly buildCommit?: string
  readonly operatorHash?: string
  readonly posthogKey?: string
  readonly posthogHost?: string
}

export type TelemetryQuotaPointsBucket = TelemetryPropertyValue<"quota_points_bucket">
export type TelemetryQuotaRemainingBucket = TelemetryPropertyValue<"quota_remaining_bucket">
export type TelemetryGitHubCaller = TelemetryPropertyValue<"github_caller">
export type TelemetryLinkMethod = TelemetryPropertyValue<"link_method">
export type TelemetryLinkSide = TelemetryPropertyValue<"link_side">
export type TelemetryLinkFailureReason = TelemetryPropertyValue<"link_failure_reason">
export type TelemetryChannelRoute = TelemetryPropertyValue<"channel_route">
export type TelemetryChannelErrorClass = TelemetryPropertyValue<"channel_error_class">
export type TelemetryRelayBytesBucket = TelemetryPropertyValue<"relay_bytes_bucket">
export type TelemetryInstallKind = TelemetryPropertyValue<"install_kind">
export type TelemetryMcpSurface = TelemetryPropertyValue<"mcp_surface">
export type TelemetryMcpProtocol = TelemetryPropertyValue<"mcp_protocol">
export type TelemetryMcpClient = TelemetryPropertyValue<"mcp_client">
export type TelemetryMcpAuth = TelemetryPropertyValue<"mcp_auth">
export type TelemetryMcpTool = TelemetryPropertyValue<"mcp_tool">

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

/** PAN-5100: the closed route template and area for a same-origin path (query and hash ignored). */
export function clientRouteOf(pathname: string): { route: TelemetryClientRoute; route_area: TelemetryClientRouteArea } {
  const clean = pathname.split(/[?#]/)[0] ?? pathname
  const segments = clean.split("/").filter((segment) => segment.length > 0)

  let bestTemplate: string | null = null
  let bestLiteralCount = -1
  for (const template of TELEMETRY_CLIENT_ROUTES) {
    if (template === "other") continue
    const templateSegments = template.split("/").filter((segment) => segment.length > 0)
    if (templateSegments.length !== segments.length) continue
    let literalCount = 0
    let matches = true
    for (let i = 0; i < templateSegments.length; i++) {
      const templateSegment = templateSegments[i]!
      const pathSegment = segments[i]!
      if (templateSegment.startsWith(":")) continue
      if (templateSegment !== pathSegment) {
        matches = false
        break
      }
      literalCount++
    }
    if (matches && literalCount > bestLiteralCount) {
      bestTemplate = template
      bestLiteralCount = literalCount
    }
  }

  const route = (bestTemplate ?? "other") as TelemetryClientRoute

  let route_area: TelemetryClientRouteArea = "other"
  if (segments[0] === "events") {
    route_area = "events"
  } else if (segments[0] === "api" && segments[1] !== undefined && (TELEMETRY_CLIENT_ROUTE_AREAS as readonly string[]).includes(segments[1])) {
    route_area = segments[1] as TelemetryClientRouteArea
  }

  return { route, route_area }
}

/** PAN-5100: an HTTP status (≥ 400) as a closed bucket. */
export function bucketRequestStatus(status: number): TelemetryRequestStatus {
  const exact = String(status)
  if ((TELEMETRY_PROPERTY_DOMAINS.request_status as readonly string[]).includes(exact)) {
    return exact as TelemetryRequestStatus
  }
  if (status >= 400 && status < 500) return "other_4xx"
  return "other_5xx"
}

/** PAN-5100: milliseconds to recover as a coarse bucket. */
export function bucketRecoveryMs(ms: number | null): TelemetryRecoveryBucket {
  if (ms === null) return "none"
  if (ms < 1_000) return "under_1s"
  if (ms < 5_000) return "1s-4s"
  if (ms < 15_000) return "5s-14s"
  if (ms < 60_000) return "15s-59s"
  return "60s+"
}

export type TelemetryEventProperties = {
  readonly [Event in TelemetryEventName]: EventProperties<Event>
}

export type TelemetryPropertiesFor<Event extends TelemetryEventName> = TelemetryEventProperties[Event]
