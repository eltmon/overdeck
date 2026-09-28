import { describe, expect, it } from "vitest"
import { isSingletonConversation, laneActivityOf, type LaneActivityInput } from "../index"

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const minutesBefore = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const row = (overrides: Partial<LaneActivityInput> = {}): LaneActivityInput => ({
  archivedAt: null,
  spawnError: null,
  status: "active",
  createdAt: minutesBefore(60),
  ...overrides,
})

describe("laneActivityOf (D10, first match wins)", () => {
  it("returns stopped for an archived row even when spawnError is set and the session is alive", () => {
    expect(laneActivityOf(row({ archivedAt: minutesBefore(1), spawnError: "boom", sessionAlive: true }), NOW)).toBe("stopped")
  })

  it("returns failed-to-start when spawnError is set, even when the session is alive", () => {
    expect(laneActivityOf(row({ spawnError: "boom", sessionAlive: true, isWorking: true }), NOW)).toBe("failed-to-start")
  })

  it("returns needs-you for an alive session with pending input", () => {
    expect(laneActivityOf(row({ sessionAlive: true, isWorking: true, pendingInputCount: 1 }), NOW)).toBe("needs-you")
  })

  it("returns working for an alive working session with no pending input", () => {
    expect(laneActivityOf(row({ sessionAlive: true, isWorking: true, pendingInputCount: 0 }), NOW)).toBe("working")
  })

  it("returns idle for an alive session that is not working", () => {
    expect(laneActivityOf(row({ sessionAlive: true }), NOW)).toBe("idle")
  })

  it("returns starting for an active row created 2 minutes before now", () => {
    expect(laneActivityOf(row({ createdAt: minutesBefore(2) }), NOW)).toBe("starting")
  })

  it("returns stopped for an active row created 4 minutes before now", () => {
    expect(laneActivityOf(row({ createdAt: minutesBefore(4) }), NOW)).toBe("stopped")
  })

  it("returns stopped for an ended row inside the starting grace", () => {
    expect(laneActivityOf(row({ status: "ended", createdAt: minutesBefore(1) }), NOW)).toBe("stopped")
  })
})

describe("isSingletonConversation", () => {
  it("matches sequencer-runner by name", () => {
    expect(isSingletonConversation({ name: "sequencer-runner" })).toBe(true)
  })

  it("matches SEQUENCER-RUNNER by issue id, case-insensitively", () => {
    expect(isSingletonConversation({ name: "conv-123", issueId: "SEQUENCER-RUNNER" })).toBe(true)
  })

  it("does not match an ordinary conversation", () => {
    expect(isSingletonConversation({ name: "conv-foo", issueId: null })).toBe(false)
  })
})
