import { Schema } from "effect"

export const FlywheelRunId = Schema.String.check(Schema.isPattern(/^RUN-\d+$/))
export type FlywheelRunId = typeof FlywheelRunId.Type

export const FlywheelHttpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i))
export type FlywheelHttpUrl = typeof FlywheelHttpUrl.Type

export const FlywheelHarness = Schema.Literals(["claude-code", "pi"])
export interface FlywheelOrchestrator {
  harness: typeof FlywheelHarness.Type
  model: string
  effort: "low" | "medium" | "high"
  ctxPercent: number
}

export const FlywheelEffort = Schema.Literals(["low", "medium", "high"])
export const FlywheelOrchestrator = Schema.Struct({
  harness: FlywheelHarness,
  model: Schema.String,
  effort: FlywheelEffort,
  ctxPercent: Schema.Number,
})

export interface FlywheelHeadline {
  bugsFixed: number
  swarmItemsMerged: number
  swarmItemsTotal: number
  prsMerged: number
  awaitingUat: number
}

export const FlywheelHeadline = Schema.Struct({
  bugsFixed: Schema.Number,
  swarmItemsMerged: Schema.Number,
  swarmItemsTotal: Schema.Number,
  prsMerged: Schema.Number,
  awaitingUat: Schema.Number,
})

export const FlywheelPipelineVerb = Schema.Literals([
  "planning",
  "working",
  "reviewing",
  "testing",
  "shipping",
  "merging",
  "blocked",
  "parked",
])

export const FlywheelPipelineStatus = Schema.Literals([
  "queued",
  "running",
  "blocked",
  "passed",
  "failed",
  "merged",
  "parked",
])

export interface FlywheelPipelineItem {
  issueId: string
  title: string
  verb: typeof FlywheelPipelineVerb.Type
  status: typeof FlywheelPipelineStatus.Type
  progressPercent?: number | undefined
  agentId?: string | undefined
  pr?: number | undefined
  mergeOrder?: number | undefined
  conflictsWith?: string[] | undefined
}

export const FlywheelPipelineItem = Schema.Struct({
  issueId: Schema.String,
  title: Schema.String,
  verb: FlywheelPipelineVerb,
  status: FlywheelPipelineStatus,
  progressPercent: Schema.optional(Schema.Number),
  agentId: Schema.optional(Schema.String),
  pr: Schema.optional(Schema.Number),
  mergeOrder: Schema.optional(Schema.Number),
  conflictsWith: Schema.optional(Schema.Array(Schema.String)),
})

export const FlywheelSubstrateBugStatus = Schema.Literals(["filed", "fixed", "workaround"])

export interface FlywheelSubstrateBug {
  issueId: string
  title: string
  status: typeof FlywheelSubstrateBugStatus.Type
  commitSha?: string | undefined
  url?: FlywheelHttpUrl | undefined
}

export const FlywheelSubstrateBug = Schema.Struct({
  issueId: Schema.String,
  title: Schema.String,
  status: FlywheelSubstrateBugStatus,
  commitSha: Schema.optional(Schema.String),
  url: Schema.optional(FlywheelHttpUrl),
})

export const FlywheelAgentStatus = Schema.Literals([
  "starting",
  "running",
  "waiting",
  "idle",
  "stopped",
  "error",
])

export interface FlywheelAgent {
  id: string
  label: string
  status: typeof FlywheelAgentStatus.Type
  issueId?: string | undefined
  role?: string | undefined
  model?: string | undefined
  ctxPercent?: number | undefined
  currentAction?: string | undefined
}

export const FlywheelAgent = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: FlywheelAgentStatus,
  issueId: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  ctxPercent: Schema.optional(Schema.Number),
  currentAction: Schema.optional(Schema.String),
})

export interface FlywheelParkedItem {
  issueId: string
  title: string
  reason: string
  parkedAt?: string | undefined
}

export const FlywheelParkedItem = Schema.Struct({
  issueId: Schema.String,
  title: Schema.String,
  reason: Schema.String,
  parkedAt: Schema.optional(Schema.String),
})

export interface FlywheelSystemStatus {
  mainHead: string
  ramUsedMb: number
  ramTotalMb: number
  swapUsedMb: number
  swapTotalMb: number
  agentsActive: number
  agentsCap: number
}

export const FlywheelSystemStatus = Schema.Struct({
  mainHead: Schema.String,
  ramUsedMb: Schema.Number,
  ramTotalMb: Schema.Number,
  swapUsedMb: Schema.Number,
  swapTotalMb: Schema.Number,
  agentsActive: Schema.Number,
  agentsCap: Schema.Number,
})

export interface FlywheelStatus {
  runId: FlywheelRunId
  startedAt: string
  elapsedMs: number
  orchestrator: FlywheelOrchestrator
  headline: FlywheelHeadline
  activePipeline: ReadonlyArray<FlywheelPipelineItem>
  substrateBugs: ReadonlyArray<FlywheelSubstrateBug>
  agents: ReadonlyArray<FlywheelAgent>
  parked: ReadonlyArray<FlywheelParkedItem>
  system: FlywheelSystemStatus
  openQuestions: ReadonlyArray<string>
  ticks: number
  lastTickAt: string
}

export const FlywheelStatus = Schema.Struct({
  runId: FlywheelRunId,
  startedAt: Schema.String,
  elapsedMs: Schema.Number,
  orchestrator: FlywheelOrchestrator,
  headline: FlywheelHeadline,
  activePipeline: Schema.Array(FlywheelPipelineItem),
  substrateBugs: Schema.Array(FlywheelSubstrateBug),
  agents: Schema.Array(FlywheelAgent),
  parked: Schema.Array(FlywheelParkedItem),
  system: FlywheelSystemStatus,
  openQuestions: Schema.Array(Schema.String),
  ticks: Schema.Number,
  lastTickAt: Schema.String,
})
