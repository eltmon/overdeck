// Flywheel substrate stats (PAN-3964 FR-4, D2).
//
// Computed on read from the tracker (issues labelled `substrate-improvement`)
// and the forge (merged PRs in the window). Nothing is stored. Only criteria
// c1 (discovery rate) and c2 (P0 count) exist: the v1 c3–c7 criteria read the
// run-record telemetry that PAN-3917 deleted, so they are non-goals.

import { Schema } from "effect"

export const FlywheelStatsCriterionStatus = Schema.Literals([
  "green",
  "yellow",
  "red",
  "insufficient_data",
])
export type FlywheelStatsCriterionStatus = typeof FlywheelStatsCriterionStatus.Type

export const FlywheelStatsTrend = Schema.Literals(["up", "down", "flat"])
export type FlywheelStatsTrend = typeof FlywheelStatsTrend.Type

export const FlywheelSubstrateSeverity = Schema.Literals(["P0", "P1", "P2", "unknown"])
export type FlywheelSubstrateSeverity = typeof FlywheelSubstrateSeverity.Type

export const FlywheelStatsWindow = Schema.Struct({
  days: Schema.Number,
  since: Schema.String,
  until: Schema.String,
})
export type FlywheelStatsWindow = typeof FlywheelStatsWindow.Type

/** c1: substrate bugs filed per merged PR in the window. */
export const FlywheelBugRateCriterion = Schema.Struct({
  /** `null` when no PR merged in the window (the rate is undefined). */
  value: Schema.NullOr(Schema.Number),
  count: Schema.Number,
  denominator: Schema.Number,
  status: FlywheelStatsCriterionStatus,
  trend: FlywheelStatsTrend,
  dataSufficient: Schema.Boolean,
})
export type FlywheelBugRateCriterion = typeof FlywheelBugRateCriterion.Type

/** c2: P0 substrate bugs filed in the window. */
export const FlywheelP0Criterion = Schema.Struct({
  value: Schema.Number,
  status: FlywheelStatsCriterionStatus,
  trend: FlywheelStatsTrend,
  dataSufficient: Schema.Boolean,
})
export type FlywheelP0Criterion = typeof FlywheelP0Criterion.Type

export const FlywheelSubstrateBugRow = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  createdAt: Schema.String,
  closedAt: Schema.NullOr(Schema.String),
  severity: FlywheelSubstrateSeverity,
})
export type FlywheelSubstrateBugRow = typeof FlywheelSubstrateBugRow.Type

export const FlywheelStats = Schema.Struct({
  window: FlywheelStatsWindow,
  generatedAt: Schema.String,
  criteria: Schema.Struct({
    c1_bugRate: FlywheelBugRateCriterion,
    c2_p0Bugs: FlywheelP0Criterion,
  }),
  bugs: Schema.Array(FlywheelSubstrateBugRow),
})
export type FlywheelStats = typeof FlywheelStats.Type

export const decodeFlywheelStats = Schema.decodeUnknownSync(FlywheelStats)
export const encodeFlywheelStats = Schema.encodeSync(FlywheelStats)
