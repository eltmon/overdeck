import { Schema } from "effect"

// ─── Primitives ───────────────────────────────────────────────────────────────

export const IssueId = Schema.String
export type IssueId = typeof IssueId.Type

export const AgentId = Schema.String
export type AgentId = typeof AgentId.Type

export const SequenceNumber = Schema.Number
export type SequenceNumber = typeof SequenceNumber.Type

// ─── Agent ────────────────────────────────────────────────────────────────────

export const AgentStatus = Schema.Literals(["starting", "running", "stopped", "error"])
export type AgentStatus = typeof AgentStatus.Type

export const AgentPhase = Schema.Literals([
  "exploration",
  "implementation",
  "testing",
  "documentation",
  "review-response",
])
export type AgentPhase = typeof AgentPhase.Type

export const AgentRuntimeStateValue = Schema.Literals([
  "active",
  "idle",
  "suspended",
  "stopped",
  "uninitialized",
])
export type AgentRuntimeStateValue = typeof AgentRuntimeStateValue.Type

export const AgentSnapshot = Schema.Struct({
  id: AgentId,
  issueId: IssueId,
  workspace: Schema.String,
  runtime: Schema.String,
  model: Schema.String,
  status: AgentStatus,
  startedAt: Schema.String,
  lastActivity: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  costSoFar: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  phase: Schema.optional(AgentPhase),
  runtimeState: Schema.optional(AgentRuntimeStateValue),
})
export type AgentSnapshot = typeof AgentSnapshot.Type

// ─── Specialist ───────────────────────────────────────────────────────────────

export const SpecialistType = Schema.Literals([
  "merge-agent",
  "review-agent",
  "test-agent",
  "inspect-agent",
  "uat-agent",
])
export type SpecialistType = typeof SpecialistType.Type

export const SpecialistState = Schema.Literals(["sleeping", "active", "uninitialized"])
export type SpecialistState = typeof SpecialistState.Type

export const SpecialistSnapshot = Schema.Struct({
  name: SpecialistType,
  state: SpecialistState,
  isRunning: Schema.Boolean,
  currentIssue: Schema.optional(Schema.String),
  lastWake: Schema.optional(Schema.String),
})
export type SpecialistSnapshot = typeof SpecialistSnapshot.Type

// ─── Review / Pipeline ────────────────────────────────────────────────────────

export const ReviewStatusValue = Schema.Literals([
  "pending",
  "reviewing",
  "passed",
  "failed",
  "blocked",
])
export type ReviewStatusValue = typeof ReviewStatusValue.Type

export const TestStatusValue = Schema.Literals([
  "pending",
  "testing",
  "passed",
  "failed",
  "skipped",
  "dispatch_failed",
])
export type TestStatusValue = typeof TestStatusValue.Type

export const MergeStatusValue = Schema.Literals(["pending", "merging", "merged", "failed"])
export type MergeStatusValue = typeof MergeStatusValue.Type

export const ReviewStatusSnapshot = Schema.Struct({
  issueId: IssueId,
  reviewStatus: ReviewStatusValue,
  testStatus: TestStatusValue,
  mergeStatus: Schema.optional(MergeStatusValue),
  readyForMerge: Schema.Boolean,
  updatedAt: Schema.String,
  prUrl: Schema.optional(Schema.String),
})
export type ReviewStatusSnapshot = typeof ReviewStatusSnapshot.Type

// ─── Resource ─────────────────────────────────────────────────────────────────

export const ResourceStats = Schema.Struct({
  containers: Schema.Number,
  networks: Schema.Number,
  volumes: Schema.optional(Schema.Number),
  cpu: Schema.optional(Schema.Number),
  memory: Schema.optional(Schema.Number),
})
export type ResourceStats = typeof ResourceStats.Type

// ─── Dashboard Snapshot ───────────────────────────────────────────────────────

export const DashboardSnapshot = Schema.Struct({
  sequence: SequenceNumber,
  agents: Schema.Array(AgentSnapshot),
  specialists: Schema.Array(SpecialistSnapshot),
  reviewStatuses: Schema.Array(ReviewStatusSnapshot),
  resources: Schema.optional(ResourceStats),
  issues: Schema.optional(Schema.Array(Schema.Unknown)),
  timestamp: Schema.String,
})
export type DashboardSnapshot = typeof DashboardSnapshot.Type

// ─── WorkspaceDetail ──────────────────────────────────────────────────────────

/** Batched response for the detail panel — replaces 5 separate HTTP calls */
export const WorkspaceDetail = Schema.Struct({
  issueId: IssueId,
  /** Local filesystem path to workspace */
  workspacePath: Schema.optional(Schema.String),
  /** Git branch */
  branch: Schema.optional(Schema.String),
  /** Review / pipeline status */
  reviewStatus: Schema.optional(ReviewStatusSnapshot),
  /** Active agent for this issue (if any) */
  agent: Schema.optional(AgentSnapshot),
  /** Planning state (if in planning phase) */
  planningStatus: Schema.optional(Schema.String),
  /** Aggregated cost in USD */
  totalCostUsd: Schema.optional(Schema.Number),
  /** Recent agent output lines */
  recentOutput: Schema.optional(Schema.Array(Schema.String)),
})
export type WorkspaceDetail = typeof WorkspaceDetail.Type
