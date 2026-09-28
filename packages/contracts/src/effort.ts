import { Schema } from "effect"

/**
 * Canonical reasoning-effort levels, end to end. `xhigh` was added in Opus 4.7
 * (between `high` and `max`); `max` predates it (Opus 4.6+/Sonnet 4.6). This is
 * the single source of truth for the enum — every other copy in the codebase
 * derives from it.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const DEFAULT_EFFORT: EffortLevel = "high"

/**
 * Where a resolved effort value came from, in resolution-precedence order
 * (most to least specific).
 */
export type EffortSource =
  | "explicit"
  | "item"
  | "plan"
  | "tier"
  | "sub-role"
  | "role"
  | "project"
  | "default"

export const EffortLevelSchema = Schema.Literals(EFFORT_LEVELS)

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value)
}

/** Compares two effort levels by rank; negative when `a` is lower than `b`. */
export function compareEffort(a: EffortLevel, b: EffortLevel): number {
  return EFFORT_LEVELS.indexOf(a) - EFFORT_LEVELS.indexOf(b)
}
