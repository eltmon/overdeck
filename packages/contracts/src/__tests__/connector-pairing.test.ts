import { describe, expect, it } from "vitest"
import { buildConnectorPairLink, buildPhonePairLink, parseConnectorPairLink, parsePhonePairLink } from "../index"

const ENV = "0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b"
const KEY = "ab".repeat(32)
const CODE = "odp_" + "cd34".repeat(16)
const INPUT = { environmentId: ENV, machineKeyHex: KEY, code: CODE }

describe("buildConnectorPairLink", () => {
  it("returns the exact documented format and round-trips through the parser", () => {
    const link = buildConnectorPairLink(INPUT)
    expect(link).toBe(`overdeck-connector:/pair#v=1&e=${ENV}&k=${KEY}&c=${CODE}`)
    expect(parseConnectorPairLink(`  ${link}\n`)).toEqual(INPUT)
  })

  it("carries a machine name with a space, an apostrophe and an ampersand through a round trip", () => {
    const labeled = { ...INPUT, machineLabel: "Ed's Mac & Pi" }
    const link = buildConnectorPairLink(labeled)
    expect(link).not.toContain("'")
    expect(link).toContain("&n=Ed%27s%20Mac%20%26%20Pi")
    expect(parseConnectorPairLink(link)).toEqual(labeled)
  })

  it("leaves n out when the machine name is blank", () => {
    expect(buildConnectorPairLink({ ...INPUT, machineLabel: "   " })).toBe(buildConnectorPairLink(INPUT))
  })

  it("throws on an uppercase key, a non-UUID environment id and a code without odp_", () => {
    expect(() => buildConnectorPairLink({ ...INPUT, machineKeyHex: KEY.toUpperCase() })).toThrow(/machineKeyHex/)
    expect(() => buildConnectorPairLink({ ...INPUT, environmentId: "not-a-uuid" })).toThrow(/environmentId/)
    expect(() => buildConnectorPairLink({ ...INPUT, code: "cd34".repeat(16) })).toThrow(/odp_/)
  })
})

describe("parseConnectorPairLink", () => {
  it("returns null for a phone link, for v=2 and for a missing c", () => {
    expect(parseConnectorPairLink(buildPhonePairLink(INPUT))).toBeNull()
    expect(parseConnectorPairLink(`overdeck-connector:/pair#v=2&e=${ENV}&k=${KEY}&c=${CODE}`)).toBeNull()
    expect(parseConnectorPairLink(`overdeck-connector:/pair#v=1&e=${ENV}&k=${KEY}`)).toBeNull()
  })

  it("omits machineLabel without n and when n is longer than 64 characters, and still parses", () => {
    const plain = parseConnectorPairLink(`overdeck-connector:/pair#v=1&e=${ENV}&k=${KEY}&c=${CODE}`)
    expect(plain).not.toBeNull()
    expect(plain).not.toHaveProperty("machineLabel")
    const long = parseConnectorPairLink(`overdeck-connector:/pair#v=1&e=${ENV}&k=${KEY}&c=${CODE}&n=${"a".repeat(65)}`)
    expect(long).toEqual(INPUT)
    expect(long).not.toHaveProperty("machineLabel")
  })

  it("is never accepted by the phone link parser", () => {
    expect(parsePhonePairLink(buildConnectorPairLink(INPUT))).toBeNull()
  })
})
