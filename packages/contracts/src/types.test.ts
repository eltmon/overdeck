import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { ReleaseStatusValue, ReviewStatusSnapshot } from "./types"

const decodeReleaseStatusValue = Schema.decodeUnknownSync(ReleaseStatusValue)
const decodeReviewStatusSnapshot = Schema.decodeUnknownSync(ReviewStatusSnapshot)
const encodeReviewStatusSnapshot = Schema.encodeSync(ReviewStatusSnapshot)

describe("ReleaseStatusValue", () => {
  it.each([
    "pending",
    "releasing",
    "passed",
    "failed",
    "partial",
    "rolled_back",
    "skipped",
  ] as const)("accepts %s", (value) => {
    expect(decodeReleaseStatusValue(value)).toBe(value)
  })

  it("rejects unknown strings", () => {
    expect(() => decodeReleaseStatusValue("unknown")).toThrow()
  })
})

describe("ReviewStatusSnapshot releaseStatus", () => {
  it("decodes and encodes releaseStatus when present", () => {
    const snapshot = {
      issueId: "PAN-399",
      releaseStatus: "partial",
    }

    const decoded = decodeReviewStatusSnapshot(snapshot)

    expect(decoded.releaseStatus).toBe("partial")
    expect(encodeReviewStatusSnapshot(decoded)).toEqual(snapshot)
  })

  it("decodes when releaseStatus is omitted", () => {
    const snapshot = {
      issueId: "PAN-399",
      mergeStatus: "merged",
    }

    expect(decodeReviewStatusSnapshot(snapshot)).toEqual(snapshot)
  })
})
