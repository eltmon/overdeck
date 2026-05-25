import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { FlywheelStats, decodeFlywheelStats, encodeFlywheelStats } from "./flywheel-stats"

const scalarCriterion = {
  label: "Substrate-bug discovery rate",
  value: 0.01,
  target: 0.02,
  status: "green",
  trend: "down",
  sampleSize: 50,
  dataSufficient: true,
} satisfies typeof FlywheelStats.Encoded["criteria"]["c1_bugRate"]

const validPayload = {
  window: "30d",
  generatedAt: "2026-05-25T09:45:00.000Z",
  criteria: {
    c1_bugRate: scalarCriterion,
    c2_p0Bugs: {
      label: "Critical/P0 substrate bugs",
      value: 0,
      target: 0,
      status: "green",
      sampleSize: 50,
      dataSufficient: true,
    },
    c3_passRate: {
      label: "Pipeline pass success rate",
      value: 0.995,
      target: 0.99,
      status: "green",
      trend: "flat",
      sampleSize: 200,
      dataSufficient: true,
    },
    c4_mttr: {
      label: "MTTR for filed substrate bugs",
      value: { medianMs: 3600000, p95Ms: 86400000 },
      target: { medianMs: 86400000, p95Ms: 604800000 },
      status: "yellow",
      sampleSize: 4,
      dataSufficient: true,
    },
    c5_intervention: {
      label: "Operator intervention rate",
      value: 0.04,
      target: 0.05,
      status: "green",
      sampleSize: 50,
      dataSufficient: true,
    },
    c6_timeConsistency: {
      label: "Time-in-pipeline consistency",
      value: { simple: 1.4, medium: 1.8, complex: 2.3 },
      target: { maxRatio: 2 },
      status: "red",
      sampleSize: 36,
      dataSufficient: true,
    },
    c7_flake: {
      label: "Substrate-attributable flake rate",
      value: 0.02,
      target: 0.05,
      status: "green",
      sampleSize: 8,
      dataSufficient: true,
    },
  },
} satisfies typeof FlywheelStats.Encoded

const criterionKeys = [
  "c1_bugRate",
  "c2_p0Bugs",
  "c3_passRate",
  "c4_mttr",
  "c5_intervention",
  "c6_timeConsistency",
  "c7_flake",
]

describe("FlywheelStats", () => {
  it("roundtrips through decode and encode", () => {
    const parsed = decodeFlywheelStats(validPayload)
    const encoded = encodeFlywheelStats(parsed)

    expect(decodeFlywheelStats(encoded)).toEqual(parsed)
  })

  it("pins the encoded JSON shape", () => {
    expect(encodeFlywheelStats(decodeFlywheelStats(validPayload))).toMatchInlineSnapshot(`
      {
        "criteria": {
          "c1_bugRate": {
            "dataSufficient": true,
            "label": "Substrate-bug discovery rate",
            "sampleSize": 50,
            "status": "green",
            "target": 0.02,
            "trend": "down",
            "value": 0.01,
          },
          "c2_p0Bugs": {
            "dataSufficient": true,
            "label": "Critical/P0 substrate bugs",
            "sampleSize": 50,
            "status": "green",
            "target": 0,
            "value": 0,
          },
          "c3_passRate": {
            "dataSufficient": true,
            "label": "Pipeline pass success rate",
            "sampleSize": 200,
            "status": "green",
            "target": 0.99,
            "trend": "flat",
            "value": 0.995,
          },
          "c4_mttr": {
            "dataSufficient": true,
            "label": "MTTR for filed substrate bugs",
            "sampleSize": 4,
            "status": "yellow",
            "target": {
              "medianMs": 86400000,
              "p95Ms": 604800000,
            },
            "value": {
              "medianMs": 3600000,
              "p95Ms": 86400000,
            },
          },
          "c5_intervention": {
            "dataSufficient": true,
            "label": "Operator intervention rate",
            "sampleSize": 50,
            "status": "green",
            "target": 0.05,
            "value": 0.04,
          },
          "c6_timeConsistency": {
            "dataSufficient": true,
            "label": "Time-in-pipeline consistency",
            "sampleSize": 36,
            "status": "red",
            "target": {
              "maxRatio": 2,
            },
            "value": {
              "complex": 2.3,
              "medium": 1.8,
              "simple": 1.4,
            },
          },
          "c7_flake": {
            "dataSufficient": true,
            "label": "Substrate-attributable flake rate",
            "sampleSize": 8,
            "status": "green",
            "target": 0.05,
            "value": 0.02,
          },
        },
        "generatedAt": "2026-05-25T09:45:00.000Z",
        "window": "30d",
      }
    `)
  })

  it("requires all seven criteria keys", () => {
    for (const key of criterionKeys) {
      const criteria = { ...validPayload.criteria }
      delete criteria[key as keyof typeof criteria]

      expect(() => decodeFlywheelStats({ ...validPayload, criteria })).toThrow()
    }
  })

  it("accepts scalar and object criterion values", () => {
    const parsed = decodeFlywheelStats(validPayload)

    expect(parsed.criteria.c1_bugRate.value).toBe(0.01)
    expect(parsed.criteria.c4_mttr.value).toEqual({ medianMs: 3600000, p95Ms: 86400000 })
  })

  it("rejects unknown statuses and trends", () => {
    expect(() => decodeFlywheelStats({
      ...validPayload,
      criteria: {
        ...validPayload.criteria,
        c1_bugRate: { ...validPayload.criteria.c1_bugRate, status: "blue" },
      },
    })).toThrow()

    expect(() => decodeFlywheelStats({
      ...validPayload,
      criteria: {
        ...validPayload.criteria,
        c1_bugRate: { ...validPayload.criteria.c1_bugRate, trend: "sideways" },
      },
    })).toThrow()
  })

  it("rejects non-json object criterion values", () => {
    expect(() => decodeFlywheelStats({
      ...validPayload,
      criteria: {
        ...validPayload.criteria,
        c4_mttr: { ...validPayload.criteria.c4_mttr, value: { medianMs: undefined } },
      },
    })).toThrow()
  })
})
