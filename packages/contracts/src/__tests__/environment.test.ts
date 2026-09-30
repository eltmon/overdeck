import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  ENVIRONMENT_PROTOCOL_VERSION,
  EnvironmentDescriptor,
  ScopedAgentRef,
  isProtocolCompatible,
} from "../environment"

const descriptor = {
  descriptorVersion: 1,
  environmentId: "env_0123456789abcdef",
  label: "desk",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.63.0",
  protocolVersion: ENVIRONMENT_PROTOCOL_VERSION,
  capabilities: { pairing: true, deviceSessions: true, terminalAuth: false },
}

describe("EnvironmentDescriptor", () => {
  it("round-trips a valid descriptor through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(EnvironmentDescriptor)(descriptor)
    const encoded = Schema.encodeSync(EnvironmentDescriptor)(decoded)
    expect(encoded).toEqual(descriptor)
  })

  it("rejects a descriptor missing capabilities", () => {
    const { capabilities: _omitted, ...withoutCapabilities } = descriptor
    expect(() => Schema.decodeUnknownSync(EnvironmentDescriptor)(withoutCapabilities)).toThrow()
  })
})

describe("ScopedAgentRef", () => {
  it("distinguishes refs with the same localId in different environments", () => {
    const decode = Schema.decodeUnknownSync(ScopedAgentRef)
    const a = decode({ environmentId: "env_a", localId: "agent-pan-1" })
    const b = decode({ environmentId: "env_b", localId: "agent-pan-1" })
    expect(a).not.toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })
})

describe("isProtocolCompatible", () => {
  it("accepts only an equal protocol version", () => {
    expect(isProtocolCompatible({ ...descriptor, protocolVersion: 1 }, 1)).toBe(true)
    expect(isProtocolCompatible({ ...descriptor, protocolVersion: 2 }, 1)).toBe(false)
  })
})
