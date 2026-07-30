import { Effect, Schema } from "effect"

export const FlywheelRunId = Schema.String.check(Schema.isPattern(/^RUN-\d+$/))
export type FlywheelRunId = typeof FlywheelRunId.Type

export const FlywheelHttpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i))
export type FlywheelHttpUrl = typeof FlywheelHttpUrl.Type

export const FlywheelHarness = Schema.Literals(["claude-code", "pi", "ohmypi", "codex", "acp", "kimi-code"])
export interface FlywheelOrchestrator {
  harness: typeof FlywheelHarness.Type
  model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  ctxPercent: number
}

export const FlywheelEffort = Schema.Literals(["low", "medium", "high", "xhigh", "max"])
export const FlywheelOrchestrator = Schema.Struct({
  harness: FlywheelHarness,
  model: Schema.String,
  effort: FlywheelEffort,
  ctxPercent: Schema.Number,
})

/**
 * Which projects the Flywheel orchestrator inventories. PAN-1696: this is the
 * ORCHESTRATOR's scope, not the merge/UAT trains' — those assemble per project
 * independent of it. Mirrors FlywheelScope in src/lib/config-yaml/schema.ts.
 */
export type FlywheelScopeValue = 'pan-only' | 'all-tracked-projects'

export const FlywheelScope = Schema.Literals(['pan-only', 'all-tracked-projects'])

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

/**
 * Pipeline verbs — display state only. They no longer gate the merge queue.
 *
 * History worth keeping (PAN-1736 / PAN-1759): the merge queue used to be
 * derived by filtering these verbs, treating only "shipping" or "merging" as
 * "at the merge gate". Any other verb on an issue that was ready_for_merge in
 * the review DB silently dropped it from the queue and from UAT batch
 * assembly — RUN-18 shipped an empty queue with five ready issues exactly that
 * way — and the queue existed only while a run was emitting a pipeline at all.
 *
 * PAN-1696 removed that coupling. The ready set is now sourced from the
 * review-status records per project (`listEligibleCandidatesByProject` +
 * `computeMergeQueueFromCandidates` in src/lib/flywheel-merge-order.ts), which
 * needs no flywheel run and cannot be affected by which verb an orchestrator
 * chose to report. Adding a verb here therefore has no merge-queue consequence;
 * it only changes what the dashboard displays.
 */
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
  conflictsWith?: readonly string[] | undefined
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

export const FlywheelSuggestionAction = Schema.Literals([
  "start",
  "resume",
  "plan",
  "review",
  "merge",
  "unblock",
  "park",
  "investigate",
  "wait",
])
export type FlywheelSuggestionAction = typeof FlywheelSuggestionAction.Type

export const FlywheelSuggestionPriority = Schema.Literals(["urgent", "high", "medium", "low"])
export type FlywheelSuggestionPriority = typeof FlywheelSuggestionPriority.Type

export interface FlywheelSuggestion {
  action: FlywheelSuggestionAction
  issueId?: string | undefined
  rationale: string
  priority: FlywheelSuggestionPriority
  filedBy?: "agent" | "operator" | undefined
  weight?: number | undefined
  weightReason?: string | undefined
}

export const FlywheelSuggestion = Schema.Struct({
  action: FlywheelSuggestionAction,
  issueId: Schema.optional(Schema.String),
  rationale: Schema.String,
  priority: FlywheelSuggestionPriority,
  filedBy: Schema.optional(Schema.Literals(["agent", "operator"])),
  weight: Schema.optional(Schema.Number),
  weightReason: Schema.optional(Schema.String),
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

export interface FlywheelOrders {
  bookId: string
  bookName: string
  landed: number
  total: number
  laneAInFlight: ReadonlyArray<string>
  laneBInFlight?: string | undefined
  drained: boolean
}

export const FlywheelOrders = Schema.Struct({
  bookId: Schema.String,
  bookName: Schema.String,
  landed: Schema.Number,
  total: Schema.Number,
  laneAInFlight: Schema.Array(Schema.String),
  laneBInFlight: Schema.optional(Schema.String),
  drained: Schema.Boolean,
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
  suggestions: ReadonlyArray<FlywheelSuggestion>
  system: FlywheelSystemStatus
  openQuestions: ReadonlyArray<string>
  orders?: FlywheelOrders | undefined
  /**
   * PAN-1696: the orchestrator scope this run was actually STARTED or RESUMED
   * with, stamped server-side from the run's launch metadata. It is deliberately
   * not the live settings value: scope is baked into the run prompt at spawn, so
   * a settings change does not reach a running orchestrator until the next start
   * or resume. Optional because runs recorded before PAN-1696 have none.
   */
  scope?: FlywheelScopeValue | undefined
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
  suggestions: Schema.Array(FlywheelSuggestion).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  system: FlywheelSystemStatus,
  openQuestions: Schema.Array(Schema.String),
  orders: Schema.optional(FlywheelOrders),
  scope: Schema.optional(FlywheelScope),
  ticks: Schema.Number,
  lastTickAt: Schema.String,
})
