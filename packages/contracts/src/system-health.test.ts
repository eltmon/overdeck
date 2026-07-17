import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  SystemHealthSnapshot,
  projectLegacySystemHealthSummary,
  type SystemHealthSnapshot as SystemHealthSnapshotType,
} from "./system-health"

const GIB = 1024 ** 3

function createSnapshot(): Omit<SystemHealthSnapshotType, "summary"> {
  return {
    version: 2,
    state: "warning",
    updatedAt: "2026-07-16T20:00:00.000Z",
    nextPollMs: 15_000,
    host: {
      state: "warning",
      platform: "linux",
      reasons: [
        {
          code: "host.memory-pressure.some",
          domain: "host",
          severity: "warning",
          message: "Memory pressure is elevated.",
          metric: "memoryPressureSomeAvg10",
          observed: 0.12,
          threshold: 0.1,
        },
      ],
      metrics: {
        cpuPercent: 42.5,
        loadAverage1m: 3.2,
        loadPerCore1m: 0.4,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 24 * GIB,
        availableMemoryBytes: 40 * GIB,
        memoryUsedPercent: 37.5,
        memoryPressureSomeAvg10: 0.12,
        memoryPressureFullAvg10: 0.01,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 2 * GIB,
        swapUsedPercent: 25,
        swapActivityBytesPerMinute: 4096,
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
        id: "agent-pan-2647",
        issueId: "PAN-2647",
        role: "work",
        kind: "work",
        status: "healthy",
        tmuxActive: true,
        memoryBytes: 2 * GIB,
        memoryGb: 2,
        cpuPercent: 4.5,
        currentIssue: "PAN-2647",
        lastActivityAt: "2026-07-16T19:59:55.000Z",
        consecutiveFailures: 0,
        killCount: 0,
        contextPercent: 31,
        reasons: [],
      },
    ],
    services: [
      {
        id: "smee-relay",
        label: "Webhook relay",
        required: false,
        status: "running",
        message: "Webhook relay is running.",
        reasons: [],
      },
    ],
    topConsumers: [
      {
        id: "agent-pan-2647",
        label: "PAN-2647 work agent",
        type: "agent",
        memoryBytes: 2 * GIB,
        memoryGb: 2,
        cpuPercent: 4.5,
        issueId: "PAN-2647",
        currentIssue: "PAN-2647",
        leaked: false,
        killTarget: {
          kind: "agent",
          agentId: "agent-pan-2647",
        },
      },
    ],
  }
}

const decodeSnapshot = Schema.decodeUnknownSync(SystemHealthSnapshot)

describe("SystemHealthSnapshot", () => {
  it("decodes a complete V2 snapshot and preserves every domain field", () => {
    const snapshot = createSnapshot()
    const payload = {
      ...snapshot,
      summary: projectLegacySystemHealthSummary(snapshot),
    }

    const decoded = decodeSnapshot(payload)

    expect(decoded).toEqual(payload)
    expect(decoded.host.metrics.memoryPressureSomeAvg10).toBe(0.12)
    expect(decoded.admission.admittedWorkAgentCount).toBe(1)
    expect(decoded.agents[0].status).toBe("healthy")
    expect(decoded.services[0].status).toBe("running")
  })

  it("maps unknown health enum values to explicit unavailable or unknown states", () => {
    const snapshot = createSnapshot()
    const payload = {
      ...snapshot,
      state: "future-state",
      host: {
        ...snapshot.host,
        state: "future-state",
        platform: "future-platform",
      },
      admission: {
        ...snapshot.admission,
        state: "future-state",
      },
      agents: [
        {
          ...snapshot.agents[0],
          kind: "future-kind",
          status: "future-state",
          lifecycle: "future-lifecycle",
        },
      ],
      services: [
        {
          ...snapshot.services[0],
          status: "future-state",
        },
      ],
      summary: projectLegacySystemHealthSummary(snapshot),
    }

    expect(() => decodeSnapshot(payload)).not.toThrow()
    const decoded = decodeSnapshot(payload)

    expect(decoded.state).toBe("unavailable")
    expect(decoded.host.state).toBe("unavailable")
    expect(decoded.host.platform).toBe("unsupported")
    expect(decoded.admission.state).toBe("unavailable")
    expect(decoded.agents[0].kind).toBe("other")
    expect(decoded.agents[0].status).toBe("unavailable")
    expect(decoded.agents[0].lifecycle).toBe("unknown")
    expect(decoded.services[0].status).toBe("unavailable")
  })

  it("rejects snapshots from an unsupported contract version", () => {
    const snapshot = createSnapshot()

    expect(() => decodeSnapshot({
      ...snapshot,
      version: 3,
      summary: projectLegacySystemHealthSummary(snapshot),
    })).toThrow()
  })
})
