import { computeFlywheelStats, parseFlywheelStatsWindow } from "../../dashboard/server/services/flywheel-telemetry.js"
import { derivePipelineRunStatsInputs, type PipelineRunStatsInputs } from "../../dashboard/server/services/pipeline-run-metrics.js"
import {
  listInWindow,
  type FlywheelSubstrateBug,
} from "./flywheel-substrate-bugs.js"
import { parseAffectedCriteria } from "./affected-criteria.js"
import { computeSubstrateBugWeight } from "./substrate-bug-weight.js"
import type { FlywheelStats } from "@overdeck/contracts"

export interface WeightedSubstrateBug {
  issueId: string
  severity: string
  filedBy: "agent" | "operator"
  affectedCriteria: number[]
  weight: number
  weightReason: string
}

export interface SubstrateBugWeightsDeps {
  listBugs?: (since: string, until: string) => FlywheelSubstrateBug[]
  computeStats?: (window: string, options?: unknown) => Promise<FlywheelStats>
  deriveInputs?: (since: string, until: string) => Promise<PipelineRunStatsInputs>
  fetchBodyAndLabels?: (
    issueId: string,
  ) => Promise<{ body: string | null; labels: string[] }>
  now?: () => Date
}

export async function listSubstrateBugWeights(
  window = "30d",
  deps: SubstrateBugWeightsDeps = {},
): Promise<WeightedSubstrateBug[]> {
  const generatedAt = (deps.now ?? (() => new Date()))()
  const parsedWindow = parseFlywheelStatsWindow(window)
  const since = new Date(generatedAt.getTime() - parsedWindow.ms).toISOString()
  const until = generatedAt.toISOString()

  const stats = deps.computeStats
    ? await deps.computeStats(window)
    : await computeFlywheelStats(window, {
        generatedAt,
        ...(await (deps.deriveInputs ?? derivePipelineRunStatsInputs)(
          since,
          until,
        )),
      })

  const bugs = (deps.listBugs ?? listInWindow)(since, until)
  const fetchBodyAndLabels =
    deps.fetchBodyAndLabels ??
    (async () => ({ body: null, labels: [] }))

  const weighted = await Promise.all(
    bugs.map(async (bug) => {
      const { body, labels } = await fetchBodyAndLabels(bug.issueId)
      const criteria = parseAffectedCriteria(body, labels)
      const { weight, reason } = computeSubstrateBugWeight(criteria, stats)
      return {
        issueId: bug.issueId,
        severity: bug.severity,
        filedBy: bug.filedBy,
        affectedCriteria: criteria,
        weight,
        weightReason: reason,
      }
    }),
  )

  return weighted.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return a.issueId.localeCompare(b.issueId)
  })
}
