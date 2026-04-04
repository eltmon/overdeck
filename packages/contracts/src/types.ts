import { Schema } from "effect"

// ─── Primitives ───────────────────────────────────────────────────────────────

export const IssueId = Schema.String
export type IssueId = typeof IssueId.Type

export const AgentId = Schema.String
export type AgentId = typeof AgentId.Type

export const SequenceNumber = Schema.Number
export type SequenceNumber = typeof SequenceNumber.Type

// ─── Agent ────────────────────────────────────────────────────────────────────

// Use Schema.String for status/phase/state fields — the existing codebase has
// many status values that evolved over time. Strict literals cause the snapshot
// to fail validation when any agent has an unexpected value. We can tighten
// these once the Effect server is the sole data source.
export const AgentSnapshot = Schema.Struct({
  id: AgentId,
  issueId: IssueId,
  workspace: Schema.optional(Schema.String),
  runtime: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  status: Schema.String,
  startedAt: Schema.optional(Schema.String),
  lastActivity: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  costSoFar: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  runtimeState: Schema.optional(Schema.String),
})
export type AgentSnapshot = typeof AgentSnapshot.Type

// ─── Specialist ───────────────────────────────────────────────────────────────

export const SpecialistSnapshot = Schema.Struct({
  name: Schema.String,
  state: Schema.String,
  isRunning: Schema.Boolean,
  currentIssue: Schema.optional(Schema.String),
  lastWake: Schema.optional(Schema.String),
})
export type SpecialistSnapshot = typeof SpecialistSnapshot.Type

// ─── Review / Pipeline ────────────────────────────────────────────────────────

export const ReviewStatusSnapshot = Schema.Struct({
  issueId: IssueId,
  reviewStatus: Schema.optional(Schema.String),
  testStatus: Schema.optional(Schema.String),
  mergeStatus: Schema.optional(Schema.String),
  readyForMerge: Schema.optional(Schema.Boolean),
  updatedAt: Schema.optional(Schema.String),
  prUrl: Schema.optional(Schema.String),
})
export type ReviewStatusSnapshot = typeof ReviewStatusSnapshot.Type

// ─── Dashboard Snapshot ──────────────────────────────────────────────────────

export const DashboardSnapshot = Schema.Struct({
  sequence: SequenceNumber,
  agents: Schema.Array(AgentSnapshot),
  specialists: Schema.Array(SpecialistSnapshot),
  reviewStatuses: Schema.Array(ReviewStatusSnapshot),
  issues: Schema.Array(Schema.Unknown),  // Issues are complex — pass through unvalidated
  resources: Schema.optional(Schema.Unknown),
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

// ─── Backward-compatible exports (used by events.ts) ─────────────────────────

export const AgentStatus = Schema.String
export type AgentStatus = string

export const AgentPhase = Schema.String  
export type AgentPhase = string

export const SpecialistType = Schema.String
export type SpecialistType = string

export const SpecialistState = Schema.String
export type SpecialistState = string

export const ReviewStatusValue = Schema.String
export type ReviewStatusValue = string

export const TestStatusValue = Schema.String
export type TestStatusValue = string

export const MergeStatusValue = Schema.String
export type MergeStatusValue = string

export const ResourceStats = Schema.Struct({
  containers: Schema.Array(Schema.Struct({
    name: Schema.String,
    cpu: Schema.optional(Schema.String),
    mem: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
  })),
})
export type ResourceStats = typeof ResourceStats.Type
