import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { FlywheelDerivedStatus, TickMarker, decodeFlywheelDerivedStatus } from "./flywheel-derived"

const running = {
  run: "running",
  conversation: {
    name: "conv-flywheel",
    id: 42,
    title: "Flywheel",
    model: "claude-opus-5-5",
    harness: "claude-code",
    cwd: "/repos/overdeck",
    sessionAlive: true,
  },
  lastTick: {
    tick: 3,
    pick: "PAN-3964",
    phase: "watch",
    inFlight: ["PAN-3964", "PAN-3920"],
    needsYou: null,
    at: "2026-09-23T10:00:00.000Z",
  },
  freshness: "live",
  policies: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false },
  inFlight: [
    {
      issueId: "PAN-3964",
      state: "in-review",
      pr: { url: "https://github.com/eltmon/overdeck/pull/1", number: 1, reviewState: "review-requested", checks: "pending", mergeable: null },
      lastJournal: { at: "2026-09-23T09:59:00.000Z", type: "review.dispatched", source: "pan-done" },
    },
    { issueId: "PAN-3920", state: "working", lastJournal: null },
  ],
  orderBook: { id: "book-1", name: "September", status: "running", landed: 2, total: 5 },
  projectRoot: "/repos/overdeck",
  generatedAt: "2026-09-23T10:00:05.000Z",
}

describe("FlywheelDerivedStatus (PAN-3964 FR-1)", () => {
  it("decodes a running status and round-trips through JSON", () => {
    const decoded = decodeFlywheelDerivedStatus(running)
    expect(decoded.run).toBe("running")
    expect(decodeFlywheelDerivedStatus(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded)
  })

  it("decodes the idle shape (no conversation, no tick, no book)", () => {
    const idle = { ...running, run: "idle", conversation: null, lastTick: null, freshness: null, inFlight: [], orderBook: null }
    expect(decodeFlywheelDerivedStatus(idle).conversation).toBeNull()
  })

  it("rejects a stored-run shape", () => {
    expect(() => decodeFlywheelDerivedStatus({ ...running, run: "complete" })).toThrow()
  })

  it("TickMarker rejects an unknown phase at the schema layer", () => {
    const decode = Schema.decodeUnknownSync(TickMarker)
    expect(() => decode({ tick: 1, pick: null, phase: "dance", inFlight: [], needsYou: null })).toThrow()
    expect(decode({ tick: 1, pick: null, phase: "idle", inFlight: [], needsYou: null }).phase).toBe("idle")
  })

  it("exports the schema", () => {
    expect(FlywheelDerivedStatus).toBeDefined()
  })
})
