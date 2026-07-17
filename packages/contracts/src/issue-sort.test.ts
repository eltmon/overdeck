import { describe, expect, it } from "vitest"
import { compareIssueIds } from "./issue-sort"

describe("compareIssueIds", () => {
  it("sorts mixed-width numeric issue ids", () => {
    expect(["PAN-2822", "PAN-806", "PAN-538", "PAN-532"].sort(compareIssueIds)).toEqual([
      "PAN-532",
      "PAN-538",
      "PAN-806",
      "PAN-2822",
    ])
  })

  it("groups different prefixes lexicographically", () => {
    expect(["PAN-1", "AUR-2"].sort(compareIssueIds)).toEqual(["AUR-2", "PAN-1"])
  })

  it("sorts non-numeric suffixes after their base id", () => {
    expect(["PAN-538", "PAN-532-hotfix", "PAN-532"].sort(compareIssueIds)).toEqual([
      "PAN-532",
      "PAN-532-hotfix",
      "PAN-538",
    ])
  })

  it("sorts Rally-style ids numerically", () => {
    expect(["F2822", "F532"].sort(compareIssueIds)).toEqual(["F532", "F2822"])
  })

  it("compares issue ids case-insensitively", () => {
    expect(compareIssueIds("pan-5", "PAN-5")).toBe(0)
  })
})
