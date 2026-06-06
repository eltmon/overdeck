import type { FlywheelStats, FlywheelStatsCriterion } from "@panctl/contracts"

interface CriterionConfig {
  key: keyof FlywheelStats["criteria"]
  name: string
  direction: "lower" | "higher" | "count"
}

interface Contribution {
  id: number
  criterion: FlywheelStatsCriterion
  config: CriterionConfig
  contribution: number
}

const criteriaById = new Map<number, CriterionConfig>([
  [1, { key: "c1_bugRate", name: "bug rate", direction: "lower" }],
  [2, { key: "c2_p0Bugs", name: "open P0s", direction: "count" }],
  [3, { key: "c3_passRate", name: "pass rate", direction: "higher" }],
  [4, { key: "c4_mttr", name: "MTTR", direction: "lower" }],
  [5, { key: "c5_intervention", name: "operator intervention rate", direction: "lower" }],
  [6, { key: "c6_timeConsistency", name: "time consistency", direction: "lower" }],
  [7, { key: "c7_flake", name: "flake rate", direction: "lower" }],
])

const statusMultiplier: Record<FlywheelStatsCriterion["status"], number> = {
  green: 1,
  yellow: 2,
  red: 3,
  insufficient_data: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function lowerDistance(value: unknown, target: unknown): number {
  const numericValue = finiteNumber(value)
  const numericTarget = finiteNumber(target)
  if (numericValue !== null && numericTarget !== null) {
    if (numericTarget === 0) return numericValue > 0 ? numericValue : 0
    return Math.max(0, (numericValue - numericTarget) / numericTarget)
  }

  if (!isRecord(value) || !isRecord(target)) return 0

  const maxRatioTarget = finiteNumber(target.maxRatio)
  if (maxRatioTarget !== null) {
    const ratios = Object.values(value).flatMap((entry) => {
      if (isRecord(entry)) {
        const ratio = finiteNumber(entry.ratio)
        return ratio === null ? [] : [ratio]
      }
      const ratio = finiteNumber(entry)
      return ratio === null ? [] : [ratio]
    })
    if (ratios.length === 0) return 0
    const worstRatio = Math.max(...ratios)
    return maxRatioTarget === 0 ? worstRatio : Math.max(0, (worstRatio - maxRatioTarget) / maxRatioTarget)
  }

  const distances = Object.entries(target).flatMap(([key, targetValue]) => {
    const targetNumber = finiteNumber(targetValue)
    const valueNumber = finiteNumber(value[key])
    if (targetNumber === null || valueNumber === null) return []
    if (targetNumber === 0) return [valueNumber > 0 ? valueNumber : 0]
    return [Math.max(0, (valueNumber - targetNumber) / targetNumber)]
  })

  return distances.length === 0 ? 0 : Math.max(...distances)
}

function higherDistance(value: unknown, target: unknown): number {
  const numericValue = finiteNumber(value)
  const numericTarget = finiteNumber(target)
  if (numericValue !== null && numericTarget !== null) {
    if (numericTarget === 0) return 0
    return Math.max(0, (numericTarget - numericValue) / numericTarget)
  }
  return 0
}

function distanceWeight(criterion: FlywheelStatsCriterion, direction: CriterionConfig["direction"]): number {
  if (direction === "count") return Math.max(0, finiteNumber(criterion.value) ?? 0)
  if (direction === "higher") return higherDistance(criterion.value, criterion.target)
  return lowerDistance(criterion.value, criterion.target)
}

function roundWeight(weight: number): number {
  return Math.round((weight + Number.EPSILON) * 100) / 100
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`
}

function formatDuration(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 48) return `${roundWeight(hours)}h`
  return `${roundWeight(hours / 24)}d`
}

function formatValue(id: number, value: FlywheelStatsCriterion["value"]): string {
  const numericValue = finiteNumber(value)
  if (numericValue !== null) {
    if ([1, 3, 5, 7].includes(id)) return formatPercent(numericValue)
    if (id === 4) return formatDuration(numericValue)
    return String(numericValue)
  }

  if (isRecord(value)) {
    if (id === 4) {
      const medianMs = finiteNumber(value.medianMs)
      if (medianMs !== null) return formatDuration(medianMs)
    }
    if (id === 6) {
      const ratios = Object.values(value).flatMap((entry) => {
        if (isRecord(entry)) {
          const ratio = finiteNumber(entry.ratio)
          return ratio === null ? [] : [ratio]
        }
        const ratio = finiteNumber(entry)
        return ratio === null ? [] : [ratio]
      })
      if (ratios.length > 0) return `${roundWeight(Math.max(...ratios))}x`
    }
  }

  return "unknown"
}

function formatTarget(id: number, target: FlywheelStatsCriterion["target"], direction: CriterionConfig["direction"]): string {
  const numericTarget = finiteNumber(target)
  if (numericTarget !== null) {
    if ([1, 3, 5, 7].includes(id)) {
      const prefix = direction === "higher" ? "≥" : "<"
      return `${prefix}${formatPercent(numericTarget)}`
    }
    if (id === 4) return `<${formatDuration(numericTarget)}`
    return String(numericTarget)
  }

  if (isRecord(target)) {
    if (id === 4) {
      const medianMs = finiteNumber(target.medianMs)
      if (medianMs !== null) return `<${formatDuration(medianMs)}`
    }
    if (id === 6) {
      const maxRatio = finiteNumber(target.maxRatio)
      if (maxRatio !== null) return `≤${maxRatio}x`
    }
  }

  return "configured target"
}

function reasonFor(contribution: Contribution): string {
  const { id, criterion, config } = contribution
  return `criterion ${id} (${config.name}) at ${formatValue(id, criterion.value)} vs target ${formatTarget(id, criterion.target, config.direction)} — ${criterion.status}`
}

export function computeSubstrateBugWeight(
  criteriaIds: readonly number[],
  stats: FlywheelStats,
): { weight: number; reason: string } {
  const contributions: Contribution[] = []

  for (const id of [...new Set(criteriaIds)]) {
    const config = criteriaById.get(id)
    if (!config) continue
    const criterion = stats.criteria[config.key]
    const contribution = distanceWeight(criterion, config.direction) * statusMultiplier[criterion.status]
    contributions.push({ id, criterion, config, contribution })
  }

  if (contributions.length === 0) {
    return { weight: 0, reason: "no affected criteria declared" }
  }

  const topContribution = contributions.reduce((top, current) => (
    current.contribution > top.contribution ? current : top
  ))
  const weight = roundWeight(contributions.reduce((sum, current) => sum + current.contribution, 0))

  return { weight, reason: reasonFor(topContribution) }
}
