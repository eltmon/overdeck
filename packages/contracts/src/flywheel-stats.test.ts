import { describe, expect, it } from "vitest"
import { decodeFlywheelStats, encodeFlywheelStats } from "./flywheel-stats"

const validPayload = {
  window: { days: 30, since: "2026-08-24T00:00:00.000Z", until: "2026-09-23T00:00:00.000Z" },
  generatedAt: "2026-09-23T00:00:00.000Z",
  criteria: {
    c1_bugRate: { value: 0.05, count: 2, denominator: 40, status: "green", trend: "down", dataSufficient: true },
    c2_p0Bugs: { value: 0, status: "green", trend: "flat", dataSufficient: true },
  },
  bugs: [
    { number: 3960, title: "Merge door wedge", createdAt: "2026-09-10T00:00:00.000Z", closedAt: null, severity: "P1" },
    { number: 3961, title: "Unlabelled", createdAt: "2026-09-11T00:00:00.000Z", closedAt: "2026-09-12T00:00:00.000Z", severity: "unknown" },
  ],
}

describe("FlywheelStats (PAN-3964 FR-4)", () => {
  it("decodes and round-trips the c1/c2 payload", () => {
    const decoded = decodeFlywheelStats(validPayload)
    expect(decoded.criteria.c1_bugRate.value).toBe(0.05)
    expect(encodeFlywheelStats(decoded)).toEqual(validPayload)
  })

  it("accepts an undefined rate when no PR merged in the window", () => {
    const payload = {
      ...validPayload,
      criteria: {
        ...validPayload.criteria,
        c1_bugRate: { value: null, count: 1, denominator: 0, status: "insufficient_data", trend: "flat", dataSufficient: false },
      },
    }
    expect(decodeFlywheelStats(payload).criteria.c1_bugRate.value).toBeNull()
  })

  it("rejects the deleted v1 c3–c7 shape (window as a string)", () => {
    expect(() => decodeFlywheelStats({ ...validPayload, window: "30d" })).toThrow()
  })

  it("rejects an unknown severity", () => {
    expect(() => decodeFlywheelStats({
      ...validPayload,
      bugs: [{ ...validPayload.bugs[0], severity: "P9" }],
    })).toThrow()
  })
})
