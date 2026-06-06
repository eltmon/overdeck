import { describe, expect, it } from "vitest"
import { parseAffectedCriteria } from "../flywheel-affected-criteria"

describe("parseAffectedCriteria", () => {
  it("parses criterion ids from the body trailer", () => {
    expect(parseAffectedCriteria("Flywheel-Affects-Criterion: 1,5", [])).toEqual([1, 5])
  })

  it("parses criterion labels", () => {
    expect(parseAffectedCriteria("", ["affects-criterion-3", "affects-criterion-5"])).toEqual([3, 5])
  })

  it("unions trailer and label criteria", () => {
    expect(parseAffectedCriteria("Flywheel-Affects-Criterion: 1", ["affects-criterion-5"])).toEqual([1, 5])
  })

  it("drops out-of-range and non-numeric ids", () => {
    expect(parseAffectedCriteria("Flywheel-Affects-Criterion: 1,8,foo", [])).toEqual([1])
  })

  it("returns an empty array for empty input", () => {
    expect(parseAffectedCriteria("", [])).toEqual([])
  })

  it("handles case-insensitive trailer keys and space-separated ids", () => {
    expect(parseAffectedCriteria("flywheel-affects-criterion: 7 2 2", [])).toEqual([2, 7])
  })
})
