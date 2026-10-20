import { describe, expect, it } from "vitest"
import {
  compareTimelineKeys,
  decodeTimelineCursor,
  encodeTimelineCursor,
  hasToolResult,
  timelineKeyOfMessage,
  timelineKeyOfWork,
  type TimelineKey,
} from "./conversation-window"

const AT = "2026-10-19T00:00:00.000Z"
const LATER = "2026-10-19T00:00:01.000Z"

describe("timeline keys", () => {
  it("builds message keys with kindRank 0 and work keys with kindRank 1, defaulting sequence to 0", () => {
    expect(timelineKeyOfMessage({ createdAt: AT, sequence: 4, id: "m1" })).toEqual([AT, 4, 0, "m1"])
    expect(timelineKeyOfWork({ createdAt: AT, id: "w1" })).toEqual([AT, 0, 1, "w1"])
  })

  it("orders by createdAt first", () => {
    const early = timelineKeyOfWork({ createdAt: AT, sequence: 9, id: "z" })
    const late = timelineKeyOfMessage({ createdAt: LATER, sequence: 1, id: "a" })
    expect(compareTimelineKeys(early, late)).toBeLessThan(0)
    expect(compareTimelineKeys(late, early)).toBeGreaterThan(0)
  })

  it("breaks a createdAt tie by sequence, then message before work, then id", () => {
    const keys: TimelineKey[] = [
      timelineKeyOfWork({ createdAt: AT, sequence: 2, id: "b" }),
      timelineKeyOfMessage({ createdAt: AT, sequence: 2, id: "z" }),
      timelineKeyOfWork({ createdAt: AT, sequence: 2, id: "a" }),
      timelineKeyOfWork({ createdAt: AT, sequence: 1, id: "y" }),
    ]
    const sorted = [...keys].sort(compareTimelineKeys)
    expect(sorted.map((k) => k[3])).toEqual(["y", "z", "a", "b"])
  })

  it("returns 0 for identical keys", () => {
    const key = timelineKeyOfMessage({ createdAt: AT, sequence: 1, id: "m" })
    expect(compareTimelineKeys(key, [...key] as unknown as TimelineKey)).toBe(0)
  })
})

describe("timeline cursors", () => {
  it("round-trips any encoded key", () => {
    const keys: TimelineKey[] = [
      [AT, 0, 0, "m1"],
      [LATER, 17, 1, "toolu_\"quoted\""],
      ["", -3.5, 1, ""],
    ]
    for (const key of keys) {
      expect(decodeTimelineCursor(encodeTimelineCursor(key))).toEqual(key)
    }
  })

  it("returns null for malformed cursors", () => {
    expect(decodeTimelineCursor("x")).toBeNull()
    expect(decodeTimelineCursor("[1,2]")).toBeNull()
    expect(decodeTimelineCursor('["a","b",0,"c"]')).toBeNull()
    expect(decodeTimelineCursor('["a",1,2,"c"]')).toBeNull()
    expect(decodeTimelineCursor('["a",1,"0","c"]')).toBeNull()
    expect(decodeTimelineCursor('["a",1,0,5]')).toBeNull()
    expect(decodeTimelineCursor('[1,1,0,"c"]')).toBeNull()
    expect(decodeTimelineCursor('["a",1,0,"c","extra"]')).toBeNull()
    expect(decodeTimelineCursor('{"0":"a"}')).toBeNull()
    expect(decodeTimelineCursor("")).toBeNull()
  })
})

describe("hasToolResult", () => {
  it("is true for an inline result or an elided one", () => {
    expect(hasToolResult({ result: "ok" })).toBe(true)
    expect(hasToolResult({ resultBytes: 5000 })).toBe(true)
    expect(hasToolResult({ result: "ok", resultBytes: 5000 })).toBe(true)
  })

  it("is false with neither", () => {
    expect(hasToolResult({})).toBe(false)
    expect(hasToolResult({ result: "" })).toBe(false)
    expect(hasToolResult({ resultBytes: 0 })).toBe(false)
  })
})
