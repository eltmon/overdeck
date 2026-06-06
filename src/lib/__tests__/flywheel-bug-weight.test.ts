import { describe, expect, it } from "vitest"
import type { FlywheelStats, FlywheelStatsCriterion } from "@panctl/contracts"
import { computeSubstrateBugWeight } from "../flywheel-bug-weight"

function criterion(overrides: Partial<FlywheelStatsCriterion> = {}): FlywheelStatsCriterion {
  return {
    label: "criterion",
    value: 0,
    target: 1,
    status: "green",
    sampleSize: 10,
    dataSufficient: true,
    ...overrides,
  }
}

function stats(overrides: Partial<FlywheelStats["criteria"]> = {}): FlywheelStats {
  return {
    window: "30d",
    generatedAt: "2026-06-06T00:00:00.000Z",
    criteria: {
      c1_bugRate: criterion({ label: "Substrate-bug discovery rate", value: 0.01, target: 0.02 }),
      c2_p0Bugs: criterion({ label: "Critical/P0 substrate bugs", value: 0, target: 0 }),
      c3_passRate: criterion({ label: "Pipeline pass success rate", value: 0.995, target: 0.99 }),
      c4_mttr: criterion({ label: "MTTR for filed substrate bugs", value: { medianMs: 0, p95Ms: 0 }, target: { medianMs: 86_400_000, p95Ms: 604_800_000 } }),
      c5_intervention: criterion({ label: "Operator intervention rate", value: 0.01, target: 0.05 }),
      c6_timeConsistency: criterion({ label: "Time-in-pipeline consistency", value: { simple: { ratio: 1.2 }, medium: { ratio: 1.5 }, complex: { ratio: 1.9 } }, target: { maxRatio: 2 } }),
      c7_flake: criterion({ label: "Substrate-attributable flake rate", value: 0.01, target: 0.05 }),
      ...overrides,
    },
  }
}

describe("computeSubstrateBugWeight", () => {
  it("weights a red criterion 1 bug by distance from target", () => {
    const result = computeSubstrateBugWeight([1], stats({
      c1_bugRate: criterion({ value: 0.032, target: 0.02, status: "red" }),
    }))

    expect(result.weight).toBe(1.8)
    expect(result.reason).toBe("criterion 1 (bug rate) at 3.2% vs target <2% — red")
  })

  it("weights a yellow higher-is-better criterion 3 bug", () => {
    const result = computeSubstrateBugWeight([3], stats({
      c3_passRate: criterion({ value: 0.985, target: 0.995, status: "yellow" }),
    }))

    expect(result.weight).toBe(0.02)
  })

  it("weights criterion 2 as an absolute count", () => {
    const result = computeSubstrateBugWeight([2], stats({
      c2_p0Bugs: criterion({ value: 3, target: 0, status: "red" }),
    }))

    expect(result.weight).toBe(9)
  })

  it("treats insufficient data as zero contribution", () => {
    const result = computeSubstrateBugWeight([1], stats({
      c1_bugRate: criterion({ value: 0.032, target: 0.02, status: "insufficient_data" }),
    }))

    expect(result.weight).toBe(0)
  })

  it("returns a stable zero-weight result for empty criteria", () => {
    expect(computeSubstrateBugWeight([], stats())).toEqual({
      weight: 0,
      reason: "no affected criteria declared",
    })
  })

  it("uses the highest contribution in the reason", () => {
    const result = computeSubstrateBugWeight([1, 2], stats({
      c1_bugRate: criterion({ value: 0.032, target: 0.02, status: "red" }),
      c2_p0Bugs: criterion({ value: 3, target: 0, status: "red" }),
    }))

    expect(result.weight).toBe(10.8)
    expect(result.reason).toBe("criterion 2 (open P0s) at 3 vs target 0 — red")
  })
})
