// Derived flywheel status (PAN-3964 FR-1, FR-2).
//
// The flywheel is a conversation running the `pan-flywheel` loop skill. It has
// no run record: every field here is computed on read from the flywheel
// conversation's row and transcript, the pipeline journals of the project's
// feature workspaces, the control settings, and the running order book. The
// derivation lives in `src/lib/flywheel/derive-status.ts`; `pan flywheel
// status`, `GET /api/flywheel/status`, and the Flywheel page all consume it.

import { Schema } from "effect"

import { DerivedPrState, IssueAttention, IssueState } from "./derived-issue-state"

/** The loop's phases, as the skill reports them in its tick marker. */
export const TickMarkerPhase = Schema.Literals([
  "orient",
  "pick",
  "launch",
  "watch",
  "park",
  "idle",
  "stopping",
])
export type TickMarkerPhase = typeof TickMarkerPhase.Type

/**
 * One parsed tick marker line:
 * `flywheel-tick: tick=<n> pick=<ID|none> phase=<phase> in-flight=<ID,…|none> needs-you=<text|none>`.
 */
export const TickMarker = Schema.Struct({
  tick: Schema.Number,
  pick: Schema.NullOr(Schema.String),
  phase: TickMarkerPhase,
  inFlight: Schema.Array(Schema.String),
  needsYou: Schema.NullOr(Schema.String),
})
export type TickMarker = typeof TickMarker.Type

/** `running` = row + live session; `paused` = row, no live session; `idle` = no row. */
export const FlywheelRunState = Schema.Literals(["running", "paused", "idle"])
export type FlywheelRunState = typeof FlywheelRunState.Type

/** Age of the last tick: ≤ 60 s live, ≤ 20 min breathing, older stalled. */
export const FlywheelFreshness = Schema.Literals(["live", "breathing", "stalled"])
export type FlywheelFreshness = typeof FlywheelFreshness.Type

export const FlywheelConversationSummary = Schema.Struct({
  name: Schema.String,
  id: Schema.Number,
  title: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  sessionAlive: Schema.Boolean,
})
export type FlywheelConversationSummary = typeof FlywheelConversationSummary.Type

export const FlywheelLastTick = Schema.Struct({
  tick: Schema.Number,
  pick: Schema.NullOr(Schema.String),
  phase: TickMarkerPhase,
  inFlight: Schema.Array(Schema.String),
  needsYou: Schema.NullOr(Schema.String),
  /** The assistant message's `createdAt`. */
  at: Schema.String,
})
export type FlywheelLastTick = typeof FlywheelLastTick.Type

export const FlywheelPolicies = Schema.Struct({
  auto_pickup_backlog: Schema.Boolean,
  require_uat_before_merge: Schema.Boolean,
  merge_train_enabled: Schema.Boolean,
})
export type FlywheelPolicies = typeof FlywheelPolicies.Type

export const FlywheelJournalSummary = Schema.Struct({
  at: Schema.String,
  type: Schema.String,
  source: Schema.optional(Schema.String),
})
export type FlywheelJournalSummary = typeof FlywheelJournalSummary.Type

export const FlywheelInFlightRow = Schema.Struct({
  issueId: Schema.String,
  state: IssueState,
  attention: Schema.optional(IssueAttention),
  pr: Schema.optional(DerivedPrState),
  lastJournal: Schema.NullOr(FlywheelJournalSummary),
})
export type FlywheelInFlightRow = typeof FlywheelInFlightRow.Type

export const FlywheelOrderBookSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  landed: Schema.Number,
  total: Schema.Number,
})
export type FlywheelOrderBookSummary = typeof FlywheelOrderBookSummary.Type

export const FlywheelDerivedStatus = Schema.Struct({
  run: FlywheelRunState,
  conversation: Schema.NullOr(FlywheelConversationSummary),
  lastTick: Schema.NullOr(FlywheelLastTick),
  freshness: Schema.NullOr(FlywheelFreshness),
  policies: FlywheelPolicies,
  inFlight: Schema.Array(FlywheelInFlightRow),
  orderBook: Schema.NullOr(FlywheelOrderBookSummary),
  projectRoot: Schema.String,
  generatedAt: Schema.String,
})
export type FlywheelDerivedStatus = typeof FlywheelDerivedStatus.Type

export const decodeFlywheelDerivedStatus = Schema.decodeUnknownSync(FlywheelDerivedStatus)
