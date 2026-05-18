import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { FlywheelStatus } from "./flywheel"

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus)

const validPayload = {
  runId: "run-2026-05-18T13-05-00Z",
  startedAt: "2026-05-18T13:05:00.000Z",
  elapsedMs: 7200000,
  orchestrator: {
    harness: "claude-code",
    model: "opus-4.7",
    effort: "high",
    ctxPercent: 42,
  },
  headline: {
    bugsFixed: 7,
    swarmItemsMerged: 11,
    swarmItemsTotal: 19,
    prsMerged: 4,
    awaitingUat: 2,
  },
  activePipeline: [
    {
      issueId: "PAN-1189",
      title: "Bake the Fix-All Flywheel into Panopticon",
      verb: "working",
      status: "running",
      progressPercent: 35,
      agentId: "agent-flywheel-1",
      pr: 123,
    },
  ],
  substrateBugs: [
    {
      issueId: "PAN-1201",
      title: "Fix flywheel status fan-out",
      status: "fixed",
      commitSha: "abc1234",
      url: "https://example.invalid/PAN-1201",
    },
  ],
  agents: [
    {
      id: "agent-flywheel-1",
      label: "flywheel-orchestrator",
      status: "running",
      issueId: "PAN-1189",
      role: "flywheel",
      model: "opus-4.7",
      ctxPercent: 42,
      currentAction: "merging approved PRs",
    },
  ],
  parked: [
    {
      issueId: "PAN-1170",
      title: "Needs product decision",
      reason: "awaiting UAT answer",
      parkedAt: "2026-05-18T14:00:00.000Z",
    },
  ],
  system: {
    mainHead: "54631d0",
    ramUsedMb: 32768,
    ramTotalMb: 65536,
    swapUsedMb: 512,
    swapTotalMb: 8192,
    agentsActive: 6,
    agentsCap: 8,
  },
  openQuestions: ["Should PAN-1170 include the new Operations sidebar copy?"],
  ticks: 12,
  lastTickAt: "2026-05-18T15:05:00.000Z",
} satisfies typeof FlywheelStatus.Encoded

describe("FlywheelStatus", () => {
  it("roundtrips through parse and stringify", () => {
    const parsed = decodeFlywheelStatus(validPayload)
    const reparsed = decodeFlywheelStatus(JSON.parse(JSON.stringify(parsed)))

    expect(reparsed).toEqual(parsed)
  })

  it("rejects payloads missing runId", () => {
    const { runId: _runId, ...payload } = validPayload

    expect(() => decodeFlywheelStatus(payload)).toThrow()
  })

  it("rejects payloads missing headline.bugsFixed", () => {
    const { bugsFixed: _bugsFixed, ...headline } = validPayload.headline

    expect(() => decodeFlywheelStatus({ ...validPayload, headline })).toThrow()
  })

  it("rejects payloads missing system.mainHead", () => {
    const { mainHead: _mainHead, ...system } = validPayload.system

    expect(() => decodeFlywheelStatus({ ...validPayload, system })).toThrow()
  })

  it("rejects wrong enum values", () => {
    expect(() => decodeFlywheelStatus({
      ...validPayload,
      orchestrator: { ...validPayload.orchestrator, effort: "maximum" },
    })).toThrow()
  })

  it("rejects wrong field types", () => {
    expect(() => decodeFlywheelStatus({
      ...validPayload,
      elapsedMs: "7200000",
    })).toThrow()
  })
})
