import { Schema } from "effect"
import { IssueId, Role } from "./types"

export const MemoryIdentity = Schema.Struct({
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: IssueId,
  runId: Schema.String,
  sessionId: Schema.String,
  agentRole: Role,
  agentHarness: Schema.String,
})
export type MemoryIdentity = typeof MemoryIdentity.Type

export const MemoryTokenUsage = Schema.Struct({
  prompt: Schema.Number,
  completion: Schema.Number,
  total: Schema.Number,
})
export type MemoryTokenUsage = typeof MemoryTokenUsage.Type

export const MemoryObservation = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: IssueId,
  runId: Schema.String,
  sessionId: Schema.String,
  agentRole: Role,
  agentHarness: Schema.String,
  gitBranch: Schema.String,
  sourceTranscriptOffset: Schema.Number,
  actionStatus: Schema.NullOr(Schema.String),
  narrative: Schema.String,
  summary: Schema.String,
  files: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  tokens: MemoryTokenUsage,
  model: Schema.String,
})
export type MemoryObservation = typeof MemoryObservation.Type

export const MemoryStatusPhase = Schema.Literals([
  "exploring",
  "planning",
  "building",
  "verifying",
  "cleaning",
  "shipping",
])
export type MemoryStatusPhase = typeof MemoryStatusPhase.Type

export const MemoryStatus = Schema.Struct({
  name: Schema.String,
  headline: Schema.String,
  summary: Schema.String,
  goal: Schema.NullOr(Schema.String),
  phase: MemoryStatusPhase,
  accomplished: Schema.Array(Schema.String),
  decided: Schema.Array(Schema.String),
  open: Schema.Array(Schema.String),
  nextSteps: Schema.Array(Schema.String),
  confidence: Schema.Number,
  workingSet: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
})
export type MemoryStatus = typeof MemoryStatus.Type

export const PendingTurn = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  identity: MemoryIdentity,
  trigger: Schema.Literals(["stop-hook", "poller", "reconciliation", "manual"]),
  transcriptPath: Schema.String,
  fromOffset: Schema.Number,
  toOffset: Schema.Number,
  lastFullLineOffset: Schema.Number,
  eventsConsumed: Schema.Number,
  compressedText: Schema.String,
})
export type PendingTurn = typeof PendingTurn.Type

export const ResetMarkerScope = Schema.Literals(["project", "workspace", "issue", "session"])
export type ResetMarkerScope = typeof ResetMarkerScope.Type

export const ResetMarker = Schema.Struct({
  id: Schema.String,
  scope: ResetMarkerScope,
  scopeId: Schema.String,
  fromTimestamp: Schema.String,
  reason: Schema.String,
  createdAt: Schema.String,
})
export type ResetMarker = typeof ResetMarker.Type

export const RagDecisionSource = Schema.Struct({
  id: Schema.String,
  docType: Schema.Literals(["observation", "summary", "status", "sibling"]),
  scope: Schema.String,
  score: Schema.Number,
  tokens: Schema.Number,
})
export type RagDecisionSource = typeof RagDecisionSource.Type

export const RagDecision = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  identity: MemoryIdentity,
  surface: Schema.Literals(["spawn", "user-prompt"]),
  outcome: Schema.Literals([
    "injected",
    "skipped",
    "no-hits",
    "expansion-failed",
    "context-too-large",
    "budget-truncated",
  ]),
  query: Schema.String,
  expandedTerms: Schema.Array(Schema.String),
  allocations: Schema.Struct({
    status: Schema.Number,
    observations: Schema.Number,
    summaries: Schema.Number,
    sibling: Schema.Number,
  }),
  sources: Schema.Array(RagDecisionSource),
  reason: Schema.NullOr(Schema.String),
})
export type RagDecision = typeof RagDecision.Type

export const ExtractionProviderTarget = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
})
export type ExtractionProviderTarget = typeof ExtractionProviderTarget.Type

export const ExtractionProviderConfig = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  providerEnvVar: Schema.optional(Schema.String),
  modelEnvVar: Schema.optional(Schema.String),
  perDayCostCapUsd: Schema.Number,
  fallbackChain: Schema.Array(ExtractionProviderTarget),
})
export type ExtractionProviderConfig = typeof ExtractionProviderConfig.Type
