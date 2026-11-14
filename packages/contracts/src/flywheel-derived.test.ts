import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  FlywheelDerivedStatus,
  TickMarker,
  decodeFlywheelDerivedStatus,
  needsYouItemKey,
  parseNeedsYouTarget,
  splitNeedsYouItems,
} from "./flywheel-derived"

const running = {
  run: "running",
  conversation: {
    name: "conv-flywheel",
    id: 42,
    title: "Flywheel",
    model: "claude-opus-5-5",
    harness: "claude-code",
    cwd: "/repos/overdeck",
    createdAt: "2026-09-23T08:00:00.000Z",
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
      title: "The flywheel page",
      state: "in-review",
      liveAgents: 1,
      inTick: true,
      pr: { url: "https://github.com/eltmon/overdeck/pull/1", number: 1, reviewState: "review-requested", checks: "pending", mergeable: null },
      lastJournal: { at: "2026-09-23T09:59:00.000Z", type: "review.dispatched", source: "pan-done" },
    },
    { issueId: "PAN-3920", title: null, trackerUnknown: true, strike: true, state: "working", liveAgents: 0, inTick: false, lastJournal: null },
  ],
  agents: [{ issueId: "PAN-3964", role: "work", harness: "claude-code", model: "claude-opus-5-5", state: "working" }],
  inFlightSource: "tick",
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

  it("rejects a running conversation with no createdAt (PAN-4199 ac2)", () => {
    const { createdAt: _dropped, ...conversation } = running.conversation
    expect(() => decodeFlywheelDerivedStatus({ ...running, conversation })).toThrow()
  })

  it("rejects a stored-run shape", () => {
    expect(() => decodeFlywheelDerivedStatus({ ...running, run: "complete" })).toThrow()
  })

  it("rejects a non-literal strike value", () => {
    const inFlight = [{ ...running.inFlight[0], strike: "yes" }, running.inFlight[1]]
    expect(() => decodeFlywheelDerivedStatus({ ...running, inFlight })).toThrow()
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

describe("splitNeedsYouItems (PAN-5198)", () => {
  it("splits on ';', trims, and drops empty pieces", () => {
    expect(splitNeedsYouItems("a; b ;; c")).toEqual(["a", "b", "c"])
  })

  it("returns [] for null, undefined and ''", () => {
    expect(splitNeedsYouItems(null)).toEqual([])
    expect(splitNeedsYouItems(undefined)).toEqual([])
    expect(splitNeedsYouItems("")).toEqual([])
  })

  it("collapses duplicates by key to the first spelling", () => {
    expect(splitNeedsYouItems("Merge PR #7; merge pr #7 ")).toEqual(["Merge PR #7"])
  })

  it("needsYouItemKey trims and lower-cases", () => {
    expect(needsYouItemKey("  PR #7 Merge ")).toBe("pr #7 merge")
  })

  it("decodeFlywheelDerivedStatus accepts a status with and without needsYouItems", () => {
    const withItems = {
      ...running,
      lastTick: {
        ...running.lastTick,
        needsYouItems: [{ text: "merge PR #7", firstRaisedTick: 2, firstRaisedAt: "2026-09-23T09:00:00.000Z" }],
      },
    }
    expect(() => decodeFlywheelDerivedStatus(withItems)).not.toThrow()
    expect(() => decodeFlywheelDerivedStatus(running)).not.toThrow()
  })
})

describe("parseNeedsYouTarget (PAN-5239)", () => {
  it("parses a trailing <https://…> target off the label", () => {
    expect(parseNeedsYouTarget("upload AAB <https://play.google.com/console/x>")).toEqual({
      label: "upload AAB",
      target: "https://play.google.com/console/x",
    })
  })

  it("returns no target key when there is nothing in angle brackets", () => {
    expect(parseNeedsYouTarget("upload AAB")).toEqual({ label: "upload AAB" })
  })

  it("treats a non-http(s) scheme in angle brackets as plain text", () => {
    expect(parseNeedsYouTarget("run it <javascript:alert(1)>")).toEqual({
      label: "run it <javascript:alert(1)>",
    })
    expect(parseNeedsYouTarget("<ftp://x>")).toEqual({ label: "<ftp://x>" })
  })

  it("treats an empty label as no target", () => {
    expect(parseNeedsYouTarget("<https://x.test>")).toEqual({ label: "<https://x.test>" })
  })

  it("needsYouItemKey ignores the target", () => {
    expect(needsYouItemKey("Upload AAB <https://a.test>")).toBe(needsYouItemKey("upload aab"))
  })

  it("documents that ';' inside a URL is unsupported: it splits the item first", () => {
    const items = splitNeedsYouItems("open <https://x.test/a;b>")
    expect(items).toEqual(["open <https://x.test/a", "b>"])
    for (const item of items) {
      expect(parseNeedsYouTarget(item).target).toBeUndefined()
    }
  })
})
