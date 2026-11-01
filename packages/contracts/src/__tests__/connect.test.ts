import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  APPROVAL_TTL_MS,
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  FREE_MACHINE_LIMIT_MESSAGE,
  INBOX_BODY_MAX_BYTES,
  INBOX_HOLD_MS,
  NO_DIRECT_PATH_MESSAGE,
  RELAY_CAP_MESSAGE,
  RELAY_MONTHLY_CAP_BYTES,
  type DirectoryEndpoint,
} from "../connect"
import { DirectoryResponse } from "../connect-view"
import type { AdvertisedEndpoint } from "../machines"

const sample = {
  signedIn: true,
  state: "online",
  url: "https://connect.overdeck.ai",
  plan: "tester",
  refusal: null,
  machines: [
    {
      environmentId: "env_0123456789abcdef",
      label: "desk",
      publicKeyHex: "ab".repeat(32),
      fingerprint: "abab-abab-abab-abab-abab",
      online: true,
      lastSeenAt: "2026-11-01T12:00:00.000Z",
      serverVersion: "0.72.0",
      endpoints: [{ kind: "lan", url: "tcp://192.168.1.4:3011" }],
      linked: false,
    },
  ],
  approvals: [
    {
      requestId: "0".repeat(32),
      from: "env_fedcba9876543210",
      label: "vps",
      fingerprint: "cdcd-cdcd-cdcd-cdcd-cdcd",
      expiresAt: 1_793_000_000_000,
      sas: "123 456",
    },
  ],
  joins: [{ requestId: "1".repeat(32), to: null, expiresAt: 1_793_000_000_000, sas: null, fingerprint: null }],
  relay: { month: "2026-11", bytesUsed: 12_345_000_000, capBytes: RELAY_MONTHLY_CAP_BYTES, stopped: false },
}

describe("connect protocol constants", () => {
  it("exports the exact user-facing strings", () => {
    expect(FREE_MACHINE_LIMIT_MESSAGE).toBe("The free account includes 3 machines")
    expect(NO_DIRECT_PATH_MESSAGE).toBe("No direct path; install Tailscale or use the relay plan")
    expect(RELAY_CAP_MESSAGE).toBe("Relay allowance used; install Tailscale or add 50 GB")
  })

  it("exports the numeric limits", () => {
    expect(CONNECT_PROTOCOL_VERSION).toBe(1)
    expect(RELAY_MONTHLY_CAP_BYTES).toBe(50_000_000_000)
    expect(INBOX_BODY_MAX_BYTES).toBe(262_144)
    expect(INBOX_HOLD_MS).toBe(86_400_000)
    expect(APPROVAL_TTL_MS).toBe(600_000)
  })

  it("exports the close codes", () => {
    expect(CONNECT_CLOSE_CODES).toEqual({
      unauthorized: 4001,
      grantExpired: 4003,
      machineLimit: 4009,
      unsupportedProtocol: 4010,
      replaced: 4011,
      forgotten: 4012,
    })
  })

  it("keeps DirectoryEndpoint structurally equal to AdvertisedEndpoint", () => {
    const advertised: AdvertisedEndpoint = { kind: "tailnet", url: "tcp://100.64.0.1:3011" }
    const endpoint: DirectoryEndpoint = advertised
    const back: AdvertisedEndpoint = endpoint
    expect(back).toBe(advertised)
  })
})

describe("DirectoryResponse", () => {
  it("accepts a sample response", () => {
    expect(Schema.decodeUnknownSync(DirectoryResponse)(sample)).toEqual(sample)
  })

  it("rejects an unknown state", () => {
    expect(() => Schema.decodeUnknownSync(DirectoryResponse)({ ...sample, state: "paused" })).toThrow()
  })
})
