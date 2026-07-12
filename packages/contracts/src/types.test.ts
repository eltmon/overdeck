import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { ReleaseStatusValue, ReviewStatusSnapshot } from "./types"

const decodeReleaseStatus = Schema.decodeUnknownSync(ReleaseStatusValue)
const decodeReviewStatus = Schema.decodeUnknownSync(ReviewStatusSnapshot)
const encodeReviewStatus = Schema.encodeSync(ReviewStatusSnapshot)

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
