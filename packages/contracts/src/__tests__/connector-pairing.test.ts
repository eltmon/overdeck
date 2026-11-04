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

  it("is never accepted by the phone link parser", () => {
    expect(parsePhonePairLink(buildConnectorPairLink(INPUT))).toBeNull()
  })
})
