import { Schema } from "effect"

// ─── Primitives ───────────────────────────────────────────────────────────────

export const IssueId = Schema.String
export type IssueId = typeof IssueId.Type

export const AgentId = Schema.String
export type AgentId = typeof AgentId.Type

export const SequenceNumber = Schema.Number
export type SequenceNumber = typeof SequenceNumber.Type

// ─── Strict literal types (PAN-433) ──────────────────────────────────────────
// Safe because the read model only contains values from typed events or
// explicitly cleaned bootstrap data.

export const AgentStatus = Schema.Literals(["starting", "running", "stopped", "error", "unknown"])
export type AgentStatus = typeof AgentStatus.Type

export const Role = Schema.Literals(["plan", "work", "review", "test", "ship"])
export type Role = typeof Role.Type

export const AgentResolution = Schema.Literals(["working", "done", "needs_input", "stuck", "completed", "unclear", "abandoned", "api_error"])
export type AgentResolution = typeof AgentResolution.Type

export const ReviewStatusValue = Schema.Literals(["pending", "reviewing", "passed", "failed", "blocked"])
export type ReviewStatusValue = typeof ReviewStatusValue.Type

export const TestStatusValue = Schema.Literals(["pending", "testing", "passed", "failed", "skipped", "dispatch_failed"])
export type TestStatusValue = typeof TestStatusValue.Type

export const MergeStatusValue = Schema.Literals(["pending", "queued", "merging", "verifying", "merged", "failed"])
export type MergeStatusValue = typeof MergeStatusValue.Type

export const VerificationStatusValue = Schema.Literals(["pending", "running", "passed", "failed", "skipped"])
export type VerificationStatusValue = typeof VerificationStatusValue.Type

// ─── Harness (PAN-636) ────────────────────────────────────────────────────────
// Identifies which coding-agent harness an agent is running under.
// AgentSnapshot.runtime is left as Schema.optional(Schema.String) for forward
// compatibility (events from older readers may carry unknown values), but every
// consumer that branches on harness MUST go through getHarness() so unknown or
// legacy values normalize to 'claude-code'.

export type Harness = 'claude-code' | 'pi'

const KNOWN_HARNESSES: ReadonlySet<string> = new Set<Harness>(['claude-code', 'pi'])

/**
 * Normalize a snapshot's runtime field to a known Harness value.
 * Unknown or missing values fall back to 'claude-code' (the default harness).
 */
export function getHarness(snapshot: { runtime?: string | undefined } | null | undefined): Harness {
  const raw = snapshot?.runtime
  if (raw && KNOWN_HARNESSES.has(raw)) {
    return raw as Harness
  }
  return 'claude-code'
}

// ─── Agent Runtime (PAN-800) ─────────────────────────────────────────────────
// High-frequency per-tool-call surface. Kept separate from AgentSnapshot because
// AgentSnapshot is the low-frequency lifecycle projection (config, status, cost)
// and merging them means every tool call re-diffs a giant object on the frontend.

export const Activity = Schema.Literals([
  "working",   // tool in flight, or tool completed <30s ago
  "thinking",  // no tool in flight, waiting for model
  "waiting",   // needs human (permission, answer, disambiguation)
  "idle",      // Stop hook fired, waiting for next turn
  "stopped",   // session ended
])
export type Activity = typeof Activity.Type

export const WaitingReason = Schema.Literals([
  "tool_permission",
  "user_question",
  "disambiguation",
  "other",
])
export type WaitingReason = typeof WaitingReason.Type

export const ClaudeChannelPermissionBehavior = Schema.Literals([
  "allow",
  "deny",
])
export type ClaudeChannelPermissionBehavior = typeof ClaudeChannelPermissionBehavior.Type

export const ThinkingState = Schema.Struct({
  since: Schema.String,        // ISO timestamp
  lastToolAt: Schema.String,   // timestamp of the tool that preceded this thinking state
})
export type ThinkingState = typeof ThinkingState.Type

export const WaitingState = Schema.Struct({
  reason: WaitingReason,
  startedAt: Schema.String,
  message: Schema.optional(Schema.String),
  notificationSent: Schema.optional(Schema.Boolean),
})
export type WaitingState = typeof WaitingState.Type

export const CHANNEL_REPLY_KIND_VALUES = ["status", "done", "needs_input"] as const
export const MAX_CHANNEL_REPLY_SUMMARY_LENGTH = 4 * 1024
export const MAX_CHANNEL_REPLY_ARTIFACT_REFS = 20
export const MAX_CHANNEL_REPLY_ARTIFACT_URI_LENGTH = 512
export const MAX_CHANNEL_REPLY_ARTIFACT_LABEL_LENGTH = 512
const CHANNEL_REPLY_ARTIFACT_URI_PATTERN = /^(?:file:\/\/|https:\/\/|\/)/

export const ChannelReplyKind = Schema.Literals(CHANNEL_REPLY_KIND_VALUES)
export type ChannelReplyKind = typeof ChannelReplyKind.Type

export function isChannelReplyKind(value: unknown): value is ChannelReplyKind {
  return typeof value === 'string' && CHANNEL_REPLY_KIND_VALUES.includes(value as ChannelReplyKind)
}

export const ChannelReplyArtifactRef = Schema.Struct({
  uri: Schema.String,
  label: Schema.optional(Schema.String),
})
export type ChannelReplyArtifactRef = typeof ChannelReplyArtifactRef.Type

export const AgentChannelReply = Schema.Struct({
  kind: ChannelReplyKind,
  summary: Schema.String,
  artifactRefs: Schema.Array(ChannelReplyArtifactRef),
  reportedAt: Schema.String,
})
export type AgentChannelReply = typeof AgentChannelReply.Type

export function normalizeChannelReplyPayload(
  payload: unknown,
  fieldPrefix = 'channel_reply',
): {
  kind: ChannelReplyKind
  summary: string
  artifactRefs: ChannelReplyArtifactRef[]
} {
  if (payload === null || typeof payload !== 'object') {
    throw new Error(`${fieldPrefix} payload must be an object`)
  }

  const source = payload as {
    kind?: unknown
    summary?: unknown
    artifactRefs?: unknown
  }

  if (!isChannelReplyKind(source.kind)) {
    throw new Error(`${fieldPrefix}.kind must be one of: ${CHANNEL_REPLY_KIND_VALUES.join(', ')}`)
  }

  if (typeof source.summary !== 'string') {
    throw new Error(`${fieldPrefix}.summary must be a non-empty string`)
  }
  const summary = source.summary.trim()
  if (summary.length === 0) {
    throw new Error(`${fieldPrefix}.summary must be a non-empty string`)
  }
  if (summary.length > MAX_CHANNEL_REPLY_SUMMARY_LENGTH) {
    throw new Error(
      `${fieldPrefix}.summary must be at most ${MAX_CHANNEL_REPLY_SUMMARY_LENGTH} characters`,
    )
  }

  if (source.artifactRefs !== undefined && !Array.isArray(source.artifactRefs)) {
    throw new Error(`${fieldPrefix}.artifactRefs must be an array when provided`)
  }
  const rawArtifactRefs = source.artifactRefs ?? []
  if (rawArtifactRefs.length > MAX_CHANNEL_REPLY_ARTIFACT_REFS) {
    throw new Error(
      `${fieldPrefix}.artifactRefs must contain at most ${MAX_CHANNEL_REPLY_ARTIFACT_REFS} entries`,
    )
  }

  const artifactRefs = rawArtifactRefs.map((item, index) => {
    if (item === null || typeof item !== 'object') {
      throw new Error(`${fieldPrefix}.artifactRefs[${index}] must be an object`)
    }
    const ref = item as { uri?: unknown; label?: unknown }
    if (typeof ref.uri !== 'string') {
      throw new Error(`${fieldPrefix}.artifactRefs[${index}].uri must be a non-empty string`)
    }
    const uri = ref.uri.trim()
    if (uri.length === 0) {
      throw new Error(`${fieldPrefix}.artifactRefs[${index}].uri must be a non-empty string`)
    }
    if (uri.length > MAX_CHANNEL_REPLY_ARTIFACT_URI_LENGTH) {
      throw new Error(
        `${fieldPrefix}.artifactRefs[${index}].uri must be at most ${MAX_CHANNEL_REPLY_ARTIFACT_URI_LENGTH} characters`,
      )
    }
    if (!CHANNEL_REPLY_ARTIFACT_URI_PATTERN.test(uri)) {
      throw new Error(
        `${fieldPrefix}.artifactRefs[${index}].uri must start with file://, https://, or /`,
      )
    }

    if (ref.label !== undefined && typeof ref.label !== 'string') {
      throw new Error(`${fieldPrefix}.artifactRefs[${index}].label must be a string when provided`)
    }
    const label = typeof ref.label === 'string' ? ref.label.trim() : undefined
    if (label !== undefined && label.length > MAX_CHANNEL_REPLY_ARTIFACT_LABEL_LENGTH) {
      throw new Error(
        `${fieldPrefix}.artifactRefs[${index}].label must be at most ${MAX_CHANNEL_REPLY_ARTIFACT_LABEL_LENGTH} characters`,
      )
    }

    return {
      uri,
      ...(label ? { label } : {}),
    }
  })

  return {
    kind: source.kind,
    summary,
    artifactRefs,
  }
}

export const AgentRuntimeSnapshot = Schema.Struct({
  id: AgentId,
  activity: Activity,
  lastActivity: Schema.String,                    // ISO timestamp of last event for this agent
  currentTool: Schema.optional(Schema.String),   // set when activity === "working"
  thinking: Schema.optional(ThinkingState),       // set when activity === "thinking"
  waiting: Schema.optional(WaitingState),         // set when activity === "waiting"
  claudeSessionId: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  lastMessageAt: Schema.optional(Schema.String),  // last user→agent message delivered
  // Last structured Claude Code Channels reply emitted by the work agent.
  channelReply: Schema.optional(AgentChannelReply),
  // Lifecycle resolution signal emitted by work-agent-stop-hook. Values mirror
  // AgentResolution so the enrichment poller can consume this as input.
  resolution: Schema.optional(AgentResolution),
  resolutionCount: Schema.optional(Schema.Number),
  resolutionUpdatedAt: Schema.optional(Schema.String),
  // For specialists: the issue currently being processed.
  currentIssue: Schema.optional(IssueId),
  updatedAtSequence: SequenceNumber,              // event sequence that produced this snapshot
})
export type AgentRuntimeSnapshot = typeof AgentRuntimeSnapshot.Type

export const ChannelPermissionRequestSnapshot = Schema.Struct({
  requestId: Schema.String,
  agentId: AgentId,
  issueId: Schema.optional(IssueId),
  toolName: Schema.String,
  description: Schema.String,
  inputPreview: Schema.String,
  createdAt: Schema.String,
})
export type ChannelPermissionRequestSnapshot = typeof ChannelPermissionRequestSnapshot.Type

// ─── Agent ────────────────────────────────────────────────────────────────────

export const AgentSnapshot = Schema.Struct({
  id: AgentId,
  issueId: IssueId,
  workspace: Schema.optional(Schema.String),
  runtime: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  status: AgentStatus,
  startedAt: Schema.optional(Schema.String),
  lastActivity: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  costSoFar: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  role: Schema.optional(Role),
  stoppedByUser: Schema.optional(Schema.Boolean),
  paused: Schema.optional(Schema.Boolean),
  pausedReason: Schema.optional(Schema.String),
  pausedAt: Schema.optional(Schema.String),
  troubled: Schema.optional(Schema.Boolean),
  troubledAt: Schema.optional(Schema.String),
  consecutiveFailures: Schema.optional(Schema.Number),
  firstFailureInRunAt: Schema.optional(Schema.String),
  lastFailureAt: Schema.optional(Schema.String),
  lastFailureReason: Schema.optional(Schema.String),
  lastFailureNextRetryAt: Schema.optional(Schema.String),
  runtimeState: Schema.optional(Schema.String),
  // Enrichment fields (PAN-440)
  hasPendingQuestion: Schema.optional(Schema.Boolean),
  pendingQuestionCount: Schema.optional(Schema.Number),
  pendingQuestionPrompt: Schema.optional(Schema.String),
  pendingQuestionReason: Schema.optional(Schema.String),
  resolution: Schema.optional(AgentResolution),
  resolutionCount: Schema.optional(Schema.Number),
  // PAN-800 — bumped on every runtime event so subscribers can cheaply detect
  // a change without diffing the full AgentRuntimeSnapshot.
  runtimeSnapshotSequence: Schema.optional(SequenceNumber),
})
export type AgentSnapshot = typeof AgentSnapshot.Type

// ─── Review / Pipeline ────────────────────────────────────────────────────────

export const ReviewStatusSnapshot = Schema.Struct({
  issueId: IssueId,
  reviewStatus: Schema.optional(ReviewStatusValue),
  testStatus: Schema.optional(TestStatusValue),
  mergeStatus: Schema.optional(MergeStatusValue),
  verificationStatus: Schema.optional(VerificationStatusValue),
  verificationNotes: Schema.optional(Schema.String),
  verificationCycleCount: Schema.optional(Schema.Number),
  readyForMerge: Schema.optional(Schema.Boolean),
  updatedAt: Schema.optional(Schema.String),
  prUrl: Schema.optional(Schema.String),
  /** Persistent stuck flag — set by divergence guard, cleared by /unstick */
  stuck: Schema.optional(Schema.Boolean),
  stuckReason: Schema.optional(Schema.String),
  stuckAt: Schema.optional(Schema.String),
  stuckDetails: Schema.optional(Schema.String),
  /** Commit SHA at which review passed; deacon uses this to detect new pushes after review */
  reviewedAtCommit: Schema.optional(Schema.String),
  /** Commit SHA at which the pre-review verification gate last passed */
  lastVerifiedCommit: Schema.optional(Schema.String),
  /** Current merge pipeline step (granular visibility for the merge step tracker) */
  mergeStep: Schema.optional(Schema.String),
  /** PAN-699: timestamp when review agents were dispatched */
  reviewSpawnedAt: Schema.optional(Schema.String),
  /** PAN-699: number of test-agent dispatch retries */
  testRetryCount: Schema.optional(Schema.Number),
  /** PAN-794: parallel-review re-dispatch retry counter (current recovery cycle) */
  reviewRetryCount: Schema.optional(Schema.Number),
  /** PAN-796: review auto-requeue count (circuit breaker threshold) */
  autoRequeueCount: Schema.optional(Schema.Number),
  /** PAN-794: ISO timestamp marking the start of the current recovery cycle */
  recoveryStartedAt: Schema.optional(Schema.String),
  /** Human-requested patrol opt-out — when true, Deacon ignores this issue. */
  deaconIgnored: Schema.optional(Schema.Boolean),
  deaconIgnoredAt: Schema.optional(Schema.String),
  deaconIgnoredReason: Schema.optional(Schema.String),
  /** Active review orchestrator tmux session name (e.g. agent-pan-540-review). */
  reviewCoordinatorSessionName: Schema.optional(Schema.String),
  /** Active review sub-role tmux session names (e.g. agent-pan-540-review-correctness). Discovered at emission time. */
  reviewSessionNames: Schema.optional(Schema.Array(Schema.String)),
  /** Per-role review completion status (keyed by role: 'correctness' | 'security' | ...) */
  reviewSubStatuses: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["running", "done"]))),
  /** PAN-905: queue position in the merge queue */
  queuePosition: Schema.optional(Schema.Number),
  /** PAN-905: currently active specialist (e.g. 'merge-agent') */
  activeSpecialist: Schema.optional(Schema.String),
  /** PAN-905: number of merge retries attempted */
  mergeRetryCount: Schema.optional(Schema.Number),
  /** PAN-905: free-form notes about the merge attempt */
  mergeNotes: Schema.optional(Schema.String),
  /** PAN-905: GitHub-native merge blocker reasons */
  blockerReasons: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.Literals(['failing_checks', 'merge_conflict', 'unresolved_conversations', 'changes_requested', 'draft_pr', 'not_mergeable']),
    summary: Schema.String,
    details: Schema.optional(Schema.String),
    detectedAt: Schema.String,
  }))),
})
export type ReviewStatusSnapshot = typeof ReviewStatusSnapshot.Type

// ─── Turn Diff ───────────────────────────────────────────────────────────────

export const TurnDiffFileChange = Schema.Struct({
  path: Schema.String,
  kind: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
})
export type TurnDiffFileChange = typeof TurnDiffFileChange.Type

export const TurnDiffSummary = Schema.Struct({
  turnId: Schema.String,
  completedAt: Schema.String,
  status: Schema.optional(Schema.String),
  files: Schema.Array(TurnDiffFileChange),
  checkpointRef: Schema.optional(Schema.String),
  assistantMessageId: Schema.optional(Schema.String),
  checkpointTurnCount: Schema.optional(Schema.Number),
})
export type TurnDiffSummary = typeof TurnDiffSummary.Type

// ─── Dashboard Snapshot ──────────────────────────────────────────────────────

export const ScanProgressSnapshot = Schema.Struct({
  active: Schema.Boolean,
  mode: Schema.Literals(['targeted', 'watched', 'system']),
  dirs: Schema.Array(Schema.String),
  dirsProcessed: Schema.Number,
  dirsTotal: Schema.Number,
  sessionsFound: Schema.Number,
  elapsedMs: Schema.Number,
  inserted: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  errors: Schema.Number,
  durationMs: Schema.Number,
})
export type ScanProgressSnapshot = typeof ScanProgressSnapshot.Type

export const EnrichStatsSnapshot = Schema.Struct({
  processed: Schema.Number,
  totalCost: Schema.Number,
  failures: Schema.Number,
  durationMs: Schema.Number,
})
export type EnrichStatsSnapshot = typeof EnrichStatsSnapshot.Type

export const EnrichProgressSnapshot = Schema.Struct({
  sessionId: Schema.Number,
  level: Schema.Number,
  model: Schema.String,
  cost: Schema.Number,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  timestamp: Schema.String,
})
export type EnrichProgressSnapshot = typeof EnrichProgressSnapshot.Type

export const EmbedProgressSnapshot = Schema.Struct({
  sessionId: Schema.Number,
  model: Schema.String,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  timestamp: Schema.String,
})
export type EmbedProgressSnapshot = typeof EmbedProgressSnapshot.Type

export const DashboardSnapshot = Schema.Struct({
  sequence: SequenceNumber,
  agents: Schema.Array(AgentSnapshot),
  specialists: Schema.Array(Schema.Unknown),
  reviewStatuses: Schema.Array(ReviewStatusSnapshot),
  issues: Schema.Array(Schema.Unknown),  // Issues are complex — pass through unvalidated
  resources: Schema.optional(Schema.Unknown),
  agentRuntimeById: Schema.optional(Schema.Record(Schema.String, AgentRuntimeSnapshot)),
  channelPermissionRequests: Schema.optional(Schema.Array(ChannelPermissionRequestSnapshot)),
  scanProgress: Schema.optional(Schema.NullOr(ScanProgressSnapshot)),
  enrichStats: Schema.optional(Schema.NullOr(EnrichStatsSnapshot)),
  enrichProgressBySessionId: Schema.optional(Schema.Record(Schema.String, EnrichProgressSnapshot)),
  embedProgressBySessionId: Schema.optional(Schema.Record(Schema.String, EmbedProgressSnapshot)),
  timestamp: Schema.String,
})
export type DashboardSnapshot = typeof DashboardSnapshot.Type

// ─── Workspace Detail ────────────────────────────────────────────────────────

export const WorkspaceDetail = Schema.Struct({
  workspace: Schema.Unknown,
  reviewStatus: Schema.Unknown,
  planning: Schema.Unknown,
  costs: Schema.Unknown,
  agentOutput: Schema.Array(Schema.String),
})
export type WorkspaceDetail = typeof WorkspaceDetail.Type

// ─── Resource Stats ──────────────────────────────────────────────────────────

export const ResourceStats = Schema.Struct({
  containers: Schema.Array(Schema.Struct({
    name: Schema.String,
    cpu: Schema.optional(Schema.String),
    mem: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
  })),
})
export type ResourceStats = typeof ResourceStats.Type

// ─── Session Tree (PAN-821) ──────────────────────────────────────────────────

export const SessionNodePresence = Schema.Literals(["active", "idle", "suspended", "ended"])
export type SessionNodePresence = typeof SessionNodePresence.Type

export const SessionNodeType = Schema.Literals([
  "planning",
  "work",
  "review",
  "reviewer",
  "test",
  "ship",
  "merge",
  "legacy",
])
export type SessionNodeType = typeof SessionNodeType.Type

export const ReviewerRoundSummary = Schema.Struct({
  round: Schema.Number,
  status: Schema.optional(Schema.String),
  reviewResult: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  endedAt: Schema.optional(Schema.String),
  durationSec: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  findings: Schema.optional(Schema.Number),
  summary: Schema.optional(Schema.String),
})
export type ReviewerRoundSummary = typeof ReviewerRoundSummary.Type

export const ReviewerRoundMetadata = Schema.Struct({
  roundCount: Schema.Number,
  latestRound: Schema.Number,
  latestStatus: Schema.optional(Schema.String),
  latestReviewResult: Schema.optional(Schema.String),
  history: Schema.Array(ReviewerRoundSummary),
})
export type ReviewerRoundMetadata = typeof ReviewerRoundMetadata.Type

export const SessionNode = Schema.Struct({
  type: SessionNodeType,
  role: Schema.optional(Schema.String),
  sessionId: Schema.String,
  tmuxSession: Schema.optional(Schema.String),
  model: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  duration: Schema.NullOr(Schema.Number),
  status: AgentStatus,
  hasJsonl: Schema.optional(Schema.Boolean),
  transcript: Schema.optional(Schema.String),
  presence: SessionNodePresence,
  awaitingInput: Schema.optional(Schema.Boolean),
  awaitingInputPrompt: Schema.optional(Schema.String),
  awaitingInputReason: Schema.optional(Schema.String),
  roundMetadata: Schema.optional(ReviewerRoundMetadata),
  deliveryMethod: Schema.optional(Schema.Literals(['auto', 'channels', 'tmux'])),
})
export type SessionNode = typeof SessionNode.Type

export const FeatureNode = Schema.Struct({
  issueId: IssueId,
  title: Schema.String,
  sessions: Schema.Array(SessionNode),
})
export type FeatureNode = typeof FeatureNode.Type

export const ProjectSessionTree = Schema.Struct({
  projectKey: Schema.String,
  features: Schema.Array(FeatureNode),
})
export type ProjectSessionTree = typeof ProjectSessionTree.Type

// ─── Discovered Sessions (PAN-457) ───────────────────────────────────────────

/** Snapshot of a discovered session for RPC responses and frontend display */
export const DiscoveredSessionSnapshot = Schema.Struct({
  id: Schema.Number,
  jsonlPath: Schema.String,
  sessionId: Schema.optional(Schema.String),
  workspacePath: Schema.optional(Schema.String),
  workspaceHash: Schema.optional(Schema.String),
  messageCount: Schema.Number,
  firstTs: Schema.optional(Schema.String),
  lastTs: Schema.optional(Schema.String),
  modelsUsed: Schema.Array(Schema.String),
  primaryModel: Schema.optional(Schema.String),
  tokenInput: Schema.Number,
  tokenOutput: Schema.Number,
  estimatedCost: Schema.Number,
  toolsUsed: Schema.Array(Schema.String),
  filesTouched: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  summary: Schema.optional(Schema.String),
  summaryDetailed: Schema.optional(Schema.String),
  enrichmentLevel: Schema.Number,
  enrichmentModel: Schema.optional(Schema.String),
  enrichedAt: Schema.optional(Schema.String),
  enrichmentFailed: Schema.Boolean,
  panopticonManaged: Schema.Boolean,
  panIssueId: Schema.optional(Schema.String),
  panAgentId: Schema.optional(Schema.String),
  scannedAt: Schema.String,
})
export type DiscoveredSessionSnapshot = typeof DiscoveredSessionSnapshot.Type

/** Filter parameters for conversation search */
export const ConversationFilter = Schema.Struct({
  workspacePath: Schema.optional(Schema.String),
  primaryModel: Schema.optional(Schema.String),
  managed: Schema.optional(Schema.Boolean),
  unmanaged: Schema.optional(Schema.Boolean),
  since: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
  minCost: Schema.optional(Schema.Number),
  maxCost: Schema.optional(Schema.Number),
  minMessages: Schema.optional(Schema.Number),
  tags: Schema.optional(Schema.Array(Schema.String)),
  tools: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.optional(Schema.Array(Schema.String)),
  issueId: Schema.optional(Schema.String),
  enrichmentLevel: Schema.optional(Schema.Number),
  enriched: Schema.optional(Schema.Boolean),
  notEnriched: Schema.optional(Schema.Boolean),
  query: Schema.optional(Schema.String),
  semantic: Schema.optional(Schema.Boolean),
  similarTo: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  format: Schema.optional(Schema.Literals(['table', 'json', 'brief', 'ids'])),
})
export type ConversationFilter = typeof ConversationFilter.Type

/** Aggregate cost breakdown for conversations */
export const ConversationCostSummary = Schema.Struct({
  groupBy: Schema.Literals(['workspace', 'model', 'day', 'month']),
  entries: Schema.Array(Schema.Struct({
    key: Schema.String,
    totalCost: Schema.Number,
    sessionCount: Schema.Number,
    totalTokensIn: Schema.Number,
    totalTokensOut: Schema.Number,
  })),
  grandTotal: Schema.Number,
  totalTokensIn: Schema.Number,
  totalTokensOut: Schema.Number,
})
export type ConversationCostSummary = typeof ConversationCostSummary.Type

/** Scan result summary */
export const ScanResult = Schema.Struct({
  inserted: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  errors: Schema.Number,
  durationMs: Schema.Number,
})
export type ScanResult = typeof ScanResult.Type
