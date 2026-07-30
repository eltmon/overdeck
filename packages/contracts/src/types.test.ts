import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { getHarness, ReleaseStatusValue, ReviewStatusSnapshot } from "./types"

const decodeReleaseStatus = Schema.decodeUnknownSync(ReleaseStatusValue)
const decodeReviewStatus = Schema.decodeUnknownSync(ReviewStatusSnapshot)
const encodeReviewStatus = Schema.encodeSync(ReviewStatusSnapshot)

describe("getHarness", () => {
  it("preserves the canonical ACP runtime literal", () => {
    expect(getHarness({ runtime: "acp" })).toBe("acp")
  })

  it("preserves the canonical kimi-code runtime literal", () => {
    expect(getHarness({ runtime: "kimi-code" })).toBe("kimi-code")
  })

  it("returns the existing target for every legacy harness string", () => {
    expect(getHarness({ runtime: "claude-code" })).toBe("claude-code")
    expect(getHarness({ runtime: "ohmypi" })).toBe("ohmypi")
    expect(getHarness({ runtime: "codex" })).toBe("codex")
    expect(getHarness({ runtime: "pi" })).toBe("ohmypi")
  })

  it("falls back to claude-code for unknown or missing runtime values", () => {
    expect(getHarness({ runtime: "not-a-harness" })).toBe("claude-code")
    expect(getHarness(undefined)).toBe("claude-code")
    expect(getHarness(null)).toBe("claude-code")
  })
})

describe("ReleaseStatusValue", () => {
  it("accepts the allowed release status literals", () => {
    const values = ["pending", "releasing", "passed", "failed", "partial", "rolled_back", "skipped"] as const
    for (const value of values) {
      expect(decodeReleaseStatus(value)).toBe(value)
    }
  })

  it("rejects any other string", () => {
    expect(() => decodeReleaseStatus("unknown")).toThrow()
  })
})

describe("ReviewStatusSnapshot", () => {
  it("decodes an object carrying releaseStatus and preserves it round-trip", () => {
    const input = {
      issueId: "PAN-399",
      releaseStatus: "releasing",
    }
    const decoded = decodeReviewStatus(input)
    expect(decoded).toEqual(input)
    expect(encodeReviewStatus(decoded)).toEqual(input)
  })

  it("decodes when releaseStatus is omitted", () => {
    const input = {
      issueId: "PAN-399",
      mergeStatus: "pending",
    }
    const decoded = decodeReviewStatus(input)
    expect(decoded).toEqual(input)
    expect(encodeReviewStatus(decoded)).toEqual(input)
  })
})
