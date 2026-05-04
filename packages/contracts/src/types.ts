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

export const AgentPhase = Schema.Literals(["planning", "exploration", "implementation", "testing", "documentation", "pre_push", "post_push", "review", "review-response", "merge"])
export type AgentPhase = typeof AgentPhase.Type

export const AgentResolution = Schema.Literals(["working", "done", "needs_input", "stuck", "completed", "unclear", "abandoned", "api_error"])
export type AgentResolution = typeof AgentResolution.Type

export const SpecialistType = Schema.Literals(["review-agent", "test-agent", "merge-agent", "inspect-agent", "uat-agent"])
export type SpecialistType = typeof SpecialistType.Type

export const SpecialistState = Schema.Literals(["active", "sleeping", "uninitialized"])
export type SpecialistState = typeof SpecialistState.Type

export const ReviewStatusValue = Schema.Literals(["pending", "reviewing", "passed", "failed", "blocked"])
export type ReviewStatusValue = typeof ReviewStatusValue.Type

export const TestStatusValue = Schema.Literals(["pending", "testing", "passed", "failed", "skipped", "dispatch_failed"])
export type TestStatusValue = typeof TestStatusValue.Type

export const MergeStatusValue = Schema.Literals(["pending", "queued", "merging", "verifying", "merged", "failed"])
export type MergeStatusValue = typeof MergeStatusValue.Type

export const VerificationStatusValue = Schema.Literals(["pending", "running", "passed", "failed", "skipped"])
export type VerificationStatusValue = typeof VerificationStatusValue.Type

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
  phase: Schema.optional(AgentPhase),
  runtimeState: Schema.optional(Schema.String),
  // Enrichment fields (PAN-440)
  agentPhase: Schema.optional(AgentPhase),
  hasPendingQuestion: Schema.optional(Schema.Boolean),
  pendingQuestionCount: Schema.optional(Schema.Number),
  resolution: Schema.optional(AgentResolution),
  resolutionCount: Schema.optional(Schema.Number),
  // PAN-800 — bumped on every runtime event so subscribers can cheaply detect
  // a change without diffing the full AgentRuntimeSnapshot.
  runtimeSnapshotSequence: Schema.optional(SequenceNumber),
})
export type AgentSnapshot = typeof AgentSnapshot.Type

// ─── Specialist ───────────────────────────────────────────────────────────────

export const SpecialistSnapshot = Schema.Struct({
  name: SpecialistType,
  state: SpecialistState,
  isRunning: Schema.Boolean,
  currentIssue: Schema.optional(Schema.String),
  lastWake: Schema.optional(Schema.String),
})
export type SpecialistSnapshot = typeof SpecialistSnapshot.Type

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
  /** Active parallel review coordinator tmux session name (e.g. review-coordinator-PAN-540-1234). */
  reviewCoordinatorSessionName: Schema.optional(Schema.String),
  /** Active parallel review tmux session names (e.g. review-PAN-540-1234-correctness). Discovered at emission time. */
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

export const DashboardSnapshot = Schema.Struct({
  sequence: SequenceNumber,
  agents: Schema.Array(AgentSnapshot),
  specialists: Schema.Array(SpecialistSnapshot),
  reviewStatuses: Schema.Array(ReviewStatusSnapshot),
  issues: Schema.Array(Schema.Unknown),  // Issues are complex — pass through unvalidated
  resources: Schema.optional(Schema.Unknown),
  turnDiffSummariesByAgentId: Schema.optional(Schema.Record(Schema.String, Schema.Array(TurnDiffSummary))),
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
  roundMetadata: Schema.optional(ReviewerRoundMetadata),
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
