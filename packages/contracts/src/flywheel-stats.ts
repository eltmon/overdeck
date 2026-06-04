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

export const FlywheelStatsCriterionValueObject = Schema.Record(Schema.String, Schema.Json)
export type FlywheelStatsCriterionValueObject = typeof FlywheelStatsCriterionValueObject.Type

export const FlywheelStatsCriterionValue = Schema.Union([
  Schema.Number,
  FlywheelStatsCriterionValueObject,
])
export type FlywheelStatsCriterionValue = typeof FlywheelStatsCriterionValue.Type

export interface FlywheelStatsCriterion {
  label: string
  value: FlywheelStatsCriterionValue
  target: FlywheelStatsCriterionValue
  status: FlywheelStatsCriterionStatus
  trend?: FlywheelStatsTrend | undefined
  sampleSize: number
  dataSufficient: boolean
}

export const FlywheelStatsCriterion = Schema.Struct({
  label: Schema.String,
  value: FlywheelStatsCriterionValue,
  target: FlywheelStatsCriterionValue,
  status: FlywheelStatsCriterionStatus,
  trend: Schema.optional(FlywheelStatsTrend),
  sampleSize: Schema.Number,
  dataSufficient: Schema.Boolean,
})

export interface FlywheelStatsCriteria {
  c1_bugRate: FlywheelStatsCriterion
  c2_p0Bugs: FlywheelStatsCriterion
  c3_passRate: FlywheelStatsCriterion
  c4_mttr: FlywheelStatsCriterion
  c5_intervention: FlywheelStatsCriterion
  c6_timeConsistency: FlywheelStatsCriterion
  c7_flake: FlywheelStatsCriterion
}

export const FlywheelStatsCriteria = Schema.Struct({
  c1_bugRate: FlywheelStatsCriterion,
  c2_p0Bugs: FlywheelStatsCriterion,
  c3_passRate: FlywheelStatsCriterion,
  c4_mttr: FlywheelStatsCriterion,
  c5_intervention: FlywheelStatsCriterion,
  c6_timeConsistency: FlywheelStatsCriterion,
  c7_flake: FlywheelStatsCriterion,
})

export interface FlywheelStats {
  window: string
  generatedAt: string
  criteria: FlywheelStatsCriteria
}

export const FlywheelStats = Schema.Struct({
  window: Schema.String,
  generatedAt: Schema.String,
  criteria: FlywheelStatsCriteria,
})

export const decodeFlywheelStats = Schema.decodeUnknownSync(FlywheelStats)
export const encodeFlywheelStats = Schema.encodeSync(FlywheelStats)
