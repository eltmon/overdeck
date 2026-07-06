import type {
  FlywheelStats,
  FlywheelStatsCriteria,
  FlywheelStatsCriterion,
  FlywheelStatsCriterionValue,
} from "@overdeck/contracts"

export const CRITERION_META: Record<
  number,
  {
    key: keyof FlywheelStatsCriteria
    direction: "lower" | "higher" | "zero"
    valueField?: string
  }
> = {
  1: { key: "c1_bugRate", direction: "lower" },
  2: { key: "c2_p0Bugs", direction: "zero" },
  3: { key: "c3_passRate", direction: "higher" },
  4: { key: "c4_mttr", direction: "lower", valueField: "medianMs" },
  5: { key: "c5_intervention", direction: "lower" },
  6: { key: "c6_timeConsistency", direction: "lower", valueField: "ratio" },
  7: { key: "c7_flake", direction: "lower" },
}

const STATUS_MULT = {
  red: 3,
  yellow: 2,
  green: 1,
  insufficient_data: 0,
} as const

const STATUS_FLOOR = {
  red: 1,
  yellow: 0.5,
  green: 0,
  insufficient_data: 0,
} as const

function resolveNumeric(
  value: FlywheelStatsCriterionValue,
  valueField: string | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const v = valueField
      ? (value as Record<string, unknown>)[valueField]
      : undefined
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return undefined
}

function normalizedDistance(
  criterion: FlywheelStatsCriterion,
  direction: "lower" | "higher" | "zero",
  valueField: string | undefined,
): number {
  const value = resolveNumeric(criterion.value, valueField)
  const target = resolveNumeric(criterion.target, valueField)
  if (value === undefined) return 0

  switch (direction) {
    case "lower": {
      if (target === undefined || target === 0) {
        return value > 0 ? Number.POSITIVE_INFINITY : 0
      }
      return Math.max(0, (value - target) / target)
    }
    case "higher": {
      if (target === undefined || target === 0) return 0
      return Math.max(0, (target - value) / target)
    }
    case "zero":
      return value
  }
}

function formatValue(
  criterion: FlywheelStatsCriterion,
  valueField: string | undefined,
): string {
  const value = resolveNumeric(criterion.value, valueField)
  if (value === undefined) return "unknown"

  switch (valueField) {
    case "medianMs":
      return `${(value / 3600000).toFixed(1)}h`
    case "ratio":
      return value.toFixed(2)
    default: {
      // Rate criteria are stored as 0..1; display as percent.
      if (value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`
      return Number.isInteger(value) ? String(value) : value.toFixed(2)
    }
  }
}

function formatTarget(
  criterion: FlywheelStatsCriterion,
  direction: "lower" | "higher" | "zero",
  valueField: string | undefined,
): string {
  const target = resolveNumeric(criterion.target, valueField)
  if (target === undefined) return "unknown target"

  let formatted: string
  switch (valueField) {
    case "medianMs":
      formatted = `${(target / 3600000).toFixed(1)}h`
      break
    case "ratio":
      formatted = target.toFixed(2)
      break
    default:
      formatted =
        target >= 0 && target <= 1 ? `${(target * 100).toFixed(1)}%` : String(target)
  }

  switch (direction) {
    case "lower":
      return `<${formatted}`
    case "higher":
      return `≥${formatted}`
    case "zero":
      return `=${formatted}`
  }
}

export function computeSubstrateBugWeight(
  criteria: number[],
  stats: FlywheelStats,
): { weight: number; reason: string } {
  if (criteria.length === 0) {
    return { weight: 0, reason: "no affected criteria declared" }
  }

  let total = 0
  let allInsufficient = true
  let top: {
    contribution: number
    id: number
    criterion: FlywheelStatsCriterion
    direction: "lower" | "higher" | "zero"
    valueField: string | undefined
  } | null = null

  for (const id of criteria) {
    const meta = CRITERION_META[id]
    if (!meta) continue
    const criterion = stats.criteria[meta.key]
    if (!criterion) continue

    const distance = normalizedDistance(criterion, meta.direction, meta.valueField)
    const mult = STATUS_MULT[criterion.status]
    const floor = STATUS_FLOOR[criterion.status]
    const contribution = mult * (floor + distance)

    total += contribution
    if (criterion.status !== "insufficient_data") {
      allInsufficient = false
    }

    if (!top || contribution > top.contribution) {
      top = {
        contribution,
        id,
        criterion,
        direction: meta.direction,
        valueField: meta.valueField,
      }
    }
  }

  if (allInsufficient || !top) {
    return { weight: 0, reason: "insufficient telemetry to rank affected criteria" }
  }

  const weight = Math.round(total * 100) / 100
  const valueText = formatValue(top.criterion, top.valueField)
  const targetText = formatTarget(top.criterion, top.direction, top.valueField)
  const reason = `criterion ${top.id} (${top.criterion.label}) ${top.criterion.status} at ${valueText} vs target ${targetText}`

  return { weight, reason }
}
