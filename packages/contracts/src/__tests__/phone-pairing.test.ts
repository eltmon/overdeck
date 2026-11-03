import { describe, expect, it } from "vitest"
import { buildPhonePairLink, PHONE_PAIR_LINK_PREFIX } from "../index"

const ENV = "0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b"
const KEY = "ab".repeat(32)
const CODE = "odp_" + "cd34".repeat(16)

describe("buildPhonePairLink", () => {
  it("returns the exact documented format for valid inputs", () => {
    const link = buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY, code: CODE })
    expect(link).toBe(`ai.overdeck.app:/pair#v=1&e=${ENV}&k=${KEY}&c=${CODE}`)
  })

  it("starts with the pair link prefix and has no scheme separator", () => {
    const link = buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY, code: CODE })
    expect(link.startsWith("ai.overdeck.app:/pair#")).toBe(true)
    expect(link).not.toContain("://")
  })

  it("throws on an uppercase machine key", () => {
    expect(() => buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY.toUpperCase(), code: CODE })).toThrow()
  })

  it("throws on a 63-character machine key", () => {
    expect(() => buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY.slice(0, 63), code: CODE })).toThrow()
  })

  it("throws on a non-v4 UUID", () => {
    const nonV4 = "0b5c6c1e-3f2a-1d8e-9a7b-1c2d3e4f5a6b"
    expect(() => buildPhonePairLink({ environmentId: nonV4, machineKeyHex: KEY, code: CODE })).toThrow()
  })

  it("throws on a code without the odp_ prefix", () => {
    expect(() => buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY, code: "cd34".repeat(16) })).toThrow()
  })

  it("exports buildPhonePairLink and PHONE_PAIR_LINK_PREFIX from the package index", () => {
    expect(buildPhonePairLink).toBeDefined()
    expect(PHONE_PAIR_LINK_PREFIX).toBeDefined()
    expect(PHONE_PAIR_LINK_PREFIX).toBe("ai.overdeck.app:/pair#")
  })
})
