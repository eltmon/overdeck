import { describe, expect, it } from "vitest"
import {
  projectLegacySystemHealthSummary,
  type SystemHealthSnapshot,
} from "./index"

const GIB = 1024 ** 3

function createSnapshot(): Omit<SystemHealthSnapshot, "summary"> {
  return {
    version: 2,
    state: "healthy",
    updatedAt: "2026-07-16T20:00:00.000Z",
    nextPollMs: 15_000,
    host: {
      state: "healthy",
      platform: "linux",
      reasons: [],
      metrics: {
        cpuPercent: 42.5,
        loadAverage1m: 3.2,
        loadPerCore1m: 0.4,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 24 * GIB,
        availableMemoryBytes: 40 * GIB,
        memoryUsedPercent: 37.5,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 2 * GIB,
        swapUsedPercent: 25,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 48 * GIB,
        commitLimitBytes: 64 * GIB,
        virtualCommitmentPercent: 75,
      },
    },
    admission: {
      state: "open",
      availableMemoryBytes: 40 * GIB,
      admittedWorkAgentCount: 1,
      reasons: [],
    },
    agents: [
      {
        id: "agent-work",
        role: "work",
        kind: "work",
        status: "healthy",
        memoryBytes: 2 * GIB,
        memoryGb: 2,
        reasons: [],
      },
      {
        id: "planning-pan-2647",
        role: "planning",
        kind: "planning",
        status: "waiting",
        memoryBytes: 1 * GIB,
        memoryGb: 1,
        reasons: [],
      },
      {
        id: "review-pan-2647",
        role: "review-correctness",
        kind: "specialist",
        status: "idle",
        lifecycle: "warm",
        memoryBytes: GIB / 2,
        memoryGb: 0.5,
        reasons: [],
      },
      {
        id: "test-pan-2647",
        role: "test",
        kind: "specialist",
        status: "warning",
        lifecycle: "orphaned",
        memoryBytes: GIB / 4,
        memoryGb: 0.25,
        reasons: [],
      },
      {
        id: "conv-pan-2647",
        kind: "conversation",
        status: "idle",
        memoryBytes: GIB / 8,
        memoryGb: 0.125,
        reasons: [],
      },
    ],
    services: [
      {
        id: "smee-relay",
        status: "degraded",
        message: "Webhook relay is disconnected.",
        reasons: [],
      },
    ],
    topConsumers: [
      {
        id: "agent-work",
        label: "Work agent",
        type: "agent",
        memoryBytes: 2 * GIB,
        memoryGb: 2,
      },
      {
        id: "container-a",
        label: "Container A",
        type: "container",
        memoryBytes: 3 * GIB,
        memoryGb: 3,
      },
      {
        id: "container-b",
        label: "Container B",
        type: "container",
        memoryBytes: GIB,
        memoryGb: 1,
      },
    ],
  }
}

describe("projectLegacySystemHealthSummary", () => {
  it("projects every compatibility field by name with legacy values", () => {
    const summary = projectLegacySystemHealthSummary(createSnapshot())

    expect(Object.keys(summary).sort()).toEqual([
      "agentCount",
      "availableMemoryBytes",
      "commitLimitBytes",
      "committedMemoryBytes",
      "containerCount",
      "containerMemoryBytes",
      "cpuPercent",
      "leakedSpecialistCount",
      "loadAverage1m",
      "loadPerCore1m",
      "memoryUsedPercent",
      "overcommitPercent",
      "overdeckMemoryBytes",
      "overdeckMemoryPercent",
      "planningAgentCount",
      "smeeRelay",
      "specialistSessionCount",
      "swapTotalBytes",
      "swapUsedBytes",
      "swapUsedPercent",
      "totalMemoryBytes",
      "usedMemoryBytes",
      "workAgentCount",
    ].sort())
    expect(summary).toEqual({
      cpuPercent: 42.5,
      loadAverage1m: 3.2,
      loadPerCore1m: 0.4,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 24 * GIB,
      availableMemoryBytes: 40 * GIB,
      memoryUsedPercent: 37.5,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 2 * GIB,
      swapUsedPercent: 25,
      committedMemoryBytes: 48 * GIB,
      commitLimitBytes: 64 * GIB,
      overcommitPercent: 75,
      agentCount: 5,
      workAgentCount: 1,
      planningAgentCount: 1,
      specialistSessionCount: 2,
      leakedSpecialistCount: 1,
      containerCount: 2,
      containerMemoryBytes: 4 * GIB,
      overdeckMemoryBytes: 7.875 * GIB,
      overdeckMemoryPercent: 12.3,
      smeeRelay: {
        configured: true,
        running: false,
        status: "unknown",
        message: "Webhook relay is disconnected.",
      },
    })
  })

  it("uses legacy zero values only in the compatibility projection when host signals are unavailable", () => {
    const snapshot = createSnapshot()
    const summary = projectLegacySystemHealthSummary({
      ...snapshot,
      host: {
        ...snapshot.host,
        metrics: Object.fromEntries(
          Object.keys(snapshot.host.metrics).map((key) => [key, null]),
        ) as unknown as typeof snapshot.host.metrics,
      },
    })

    expect(summary.cpuPercent).toBe(0)
    expect(summary.availableMemoryBytes).toBe(0)
    expect(summary.swapUsedPercent).toBe(0)
    expect(summary.overcommitPercent).toBe(0)
    expect(summary.overdeckMemoryPercent).toBe(0)
  })
})
