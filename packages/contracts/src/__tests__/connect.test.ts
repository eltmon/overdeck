import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  ACTIVITY_COUNT_MAX,
  ACTIVITY_PUSH_RATE_PER_MINUTE,
  ACTIVITY_REFRESH_MS,
  ACTIVITY_STALE_MS,
  APPROVAL_TTL_MS,
  CLIENT_LIMIT,
  CLIENT_LIMIT_MESSAGE,
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  CONNECTOR_LIMIT,
  CONNECTOR_LIMIT_MESSAGE,
  FREE_MACHINE_LIMIT_MESSAGE,
  INBOX_BODY_MAX_BYTES,
  INBOX_HOLD_MS,
  NO_DIRECT_PATH_MESSAGE,
  PUSH_PLAINTEXT_MAX_BYTES,
  PUSH_RATE_PER_MINUTE,
  PUSH_SEALED_MAX_CHARS,
  RELAY_CAP_MESSAGE,
  RELAY_MONTHLY_CAP_BYTES,
  type ClientToDirectoryFrame,
  type DirectoryEndpoint,
  type DirectoryToClientFrame,
  type DirectoryToMachineFrame,
  type LiveActivityCounts,
  type MachineToDirectoryFrame,
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
      state: "open",
      error: null,
    },
  ],
  joins: [{ requestId: "1".repeat(32), to: null, expiresAt: 1_793_000_000_000, sas: null, fingerprint: null, state: "waiting" }],
  relay: { month: "2026-11", bytesUsed: 12_345_000_000, capBytes: RELAY_MONTHLY_CAP_BYTES, stopped: false },
}

describe("connect protocol constants", () => {
  it("exports the exact user-facing strings", () => {
    expect(FREE_MACHINE_LIMIT_MESSAGE).toBe("The free account includes 3 machines")
    expect(NO_DIRECT_PATH_MESSAGE).toBe("No direct path; install Tailscale or use the relay plan")
    expect(RELAY_CAP_MESSAGE).toBe("Relay allowance used; install Tailscale or add 50 GB")
    expect(CLIENT_LIMIT_MESSAGE).toBe("This account already has 5 phones. Remove one in the app or on a machine.")
    expect(CONNECTOR_LIMIT_MESSAGE).toBe("This account already has 10 Overdeck connectors. Remove one in Settings → Anywhere → Bots.")
  })

  it("exports the numeric limits", () => {
    expect(CONNECT_PROTOCOL_VERSION).toBe(1)
    expect(RELAY_MONTHLY_CAP_BYTES).toBe(50_000_000_000)
    expect(INBOX_BODY_MAX_BYTES).toBe(262_144)
    expect(INBOX_HOLD_MS).toBe(86_400_000)
    expect(APPROVAL_TTL_MS).toBe(600_000)
    expect(CLIENT_LIMIT).toBe(5)
    expect(CONNECTOR_LIMIT).toBe(10)
    expect(PUSH_RATE_PER_MINUTE).toBe(30)
    expect(PUSH_SEALED_MAX_CHARS).toBe(3072)
    expect(PUSH_PLAINTEXT_MAX_BYTES).toBe(2256)
    expect(4 * Math.ceil((PUSH_PLAINTEXT_MAX_BYTES + 48) / 3)).toBe(PUSH_SEALED_MAX_CHARS)
  })

  it("exports the close codes", () => {
    expect(CONNECT_CLOSE_CODES).toEqual({
      unauthorized: 4001,
      grantExpired: 4003,
      machineLimit: 4009,
      unsupportedProtocol: 4010,
      replaced: 4011,
      forgotten: 4012,
      clientLimit: 4013,
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

describe("phone client and push frames (PAN-4828)", () => {
  const clientFrames: ClientToDirectoryFrame[] = [
    {
      type: "hello-client",
      protocol: 1,
      clientId: "00000000-0000-4000-8000-0000000000aa",
      label: "iPhone",
      publicKeyHex: "ab".repeat(32),
      appVersion: "1.0.0",
      platform: "ios",
    },
    {
      type: "hello-client",
      protocol: 1,
      clientId: "00000000-0000-4000-8000-0000000000bb",
      label: "connector",
      publicKeyHex: "cd".repeat(32),
      appVersion: "1.0.0",
      platform: "node",
    },
    {
      type: "signal",
      to: "env_0123456789abcdef",
      session: "0".repeat(32),
      purpose: "link",
      relay: false,
      data: { sdp: { type: "offer", sdp: "v=0" } },
    },
    { type: "ice-servers", requestId: "r", relay: false },
    { type: "relay-usage", bytes: 0 },
    { type: "push-register", platform: "ios", token: "tok", apsEnvironment: "sandbox" },
    { type: "push-unregister" },
    { type: "forget-client" },
  ]
  const clientBound: DirectoryToClientFrame[] = [
    { type: "welcome-client", protocol: 1, plan: "tester", relayAllowed: true, machines: [] },
    { type: "directory", machines: [] },
  ]
  const pushFrame: MachineToDirectoryFrame = {
    type: "push",
    requestId: "0".repeat(32),
    to: "00000000-0000-4000-8000-0000000000aa",
    sealed: "AAAA",
    urgency: "high",
    collapseId: "1".repeat(32),
  }
  const pushResults: DirectoryToMachineFrame[] = [
    { type: "push-result", requestId: "r", ok: true },
    { type: "push-result", requestId: "r", ok: false, error: "rate_limited" },
  ]

  it("covers every client frame type", () => {
    expect(clientFrames.map((f) => f.type).sort()).toEqual([
      "forget-client",
      "hello-client",
      "hello-client",
      "ice-servers",
      "push-register",
      "push-unregister",
      "relay-usage",
      "signal",
    ])
  })

  it("round-trips every new frame through JSON", () => {
    for (const f of [...clientFrames, ...clientBound, pushFrame, ...pushResults]) {
      expect(JSON.parse(JSON.stringify(f))).toEqual(f)
    }
  })

  it("rejects malformed frames at compile time", () => {
    // @ts-expect-error "web" is not a ClientPlatform
    const badPlatform: ClientToDirectoryFrame = { type: "hello-client", protocol: 1, clientId: "c", label: "l", publicKeyHex: "ab".repeat(32), appVersion: "1.0.0", platform: "web" }
    // @ts-expect-error hello-client requires clientId
    const missingClientId: ClientToDirectoryFrame = { type: "hello-client", protocol: 1, label: "l", publicKeyHex: "ab".repeat(32), appVersion: "1.0.0", platform: "ios" }
    // @ts-expect-error a client signal's purpose is always "link"
    const approvalSignal: ClientToDirectoryFrame = { type: "signal", to: "e", session: "0".repeat(32), purpose: "approval", relay: false, data: {} }
    // @ts-expect-error "low" is not a PushUrgency
    const badUrgency: MachineToDirectoryFrame = { type: "push", requestId: "0".repeat(32), to: "c", sealed: "AAAA", urgency: "low", collapseId: "1".repeat(32) }
    // @ts-expect-error a failed push-result requires an error
    const missingError: DirectoryToMachineFrame = { type: "push-result", requestId: "r", ok: false }
    // @ts-expect-error a successful push-result cannot carry an error
    const extraError: DirectoryToMachineFrame = { type: "push-result", requestId: "r", ok: true, error: "rate_limited" }
    // @ts-expect-error clients never get approval-cancel
    const approvalCancel: DirectoryToClientFrame = { type: "approval-cancel", requestId: "0".repeat(32) }
    // @ts-expect-error "node" cannot register push
    const nodePushRegister: ClientToDirectoryFrame = { type: "push-register", platform: "node", token: "tok" }
    const rejected = [badPlatform, missingClientId, approvalSignal, badUrgency, missingError, extraError, approvalCancel, nodePushRegister]
    expect(rejected).toHaveLength(8)
  })

  it("lets the directory reuse machine frames for clients", () => {
    const fromMachine: Extract<DirectoryToMachineFrame, { type: "directory" }> = { type: "directory", machines: [] }
    const forClient: DirectoryToClientFrame = fromMachine
    expect(forClient.type).toBe("directory")
  })
})

describe("Live Activity frames and constants (PAN-4839)", () => {
  const pushActivity: MachineToDirectoryFrame = {
    type: "push-activity",
    to: "00000000-0000-4000-8000-0000000000aa",
    needsYou: 3,
    running: 2,
  }
  const activityRegister: ClientToDirectoryFrame = { type: "activity-register", token: "tok", apsEnvironment: "sandbox" }
  const activityRegisterProduction: ClientToDirectoryFrame = { type: "activity-register", token: "tok" }
  const activityUnregister: ClientToDirectoryFrame = { type: "activity-unregister" }

  it("exports the Live Activity constants", () => {
    expect(ACTIVITY_STALE_MS).toBe(600_000)
    expect(ACTIVITY_REFRESH_MS).toBe(240_000)
    expect(ACTIVITY_PUSH_RATE_PER_MINUTE).toBe(60)
    expect(ACTIVITY_COUNT_MAX).toBe(9_999)
    expect(ACTIVITY_REFRESH_MS).toBeLessThan(ACTIVITY_STALE_MS)
    expect(CONNECT_PROTOCOL_VERSION).toBe(1)
  })

  it("keeps push-activity to exactly type, to, needsYou and running", () => {
    expect(Object.keys(pushActivity).sort()).toEqual(["needsYou", "running", "to", "type"])
    const counts: LiveActivityCounts = { needsYou: 3, running: 2 }
    expect(Object.keys(counts).sort()).toEqual(["needsYou", "running"])
  })

  it("keeps activity-register to type, token and an optional apsEnvironment", () => {
    expect(Object.keys(activityRegister).sort()).toEqual(["apsEnvironment", "token", "type"])
    expect(Object.keys(activityRegisterProduction).sort()).toEqual(["token", "type"])
    expect(Object.keys(activityUnregister)).toEqual(["type"])
  })

  it("round-trips push-activity, activity-register and activity-unregister through JSON", () => {
    for (const f of [pushActivity, activityRegister, activityRegisterProduction, activityUnregister]) {
      expect(JSON.parse(JSON.stringify(f))).toEqual(f)
    }
  })

  it("rejects malformed Live Activity frames at compile time", () => {
    // @ts-expect-error push-activity carries counts only, never a title
    const withTitle: MachineToDirectoryFrame = { type: "push-activity", to: "c", needsYou: 1, running: 1, title: "x" }
    // @ts-expect-error push-activity requires running
    const missingRunning: MachineToDirectoryFrame = { type: "push-activity", to: "c", needsYou: 1 }
    // @ts-expect-error activity-register requires a token
    const missingToken: ClientToDirectoryFrame = { type: "activity-register" }
    // @ts-expect-error "staging" is not an ApsEnvironment
    const badEnvironment: ClientToDirectoryFrame = { type: "activity-register", token: "tok", apsEnvironment: "staging" }
    // @ts-expect-error activity-register carries no platform: it is iOS only
    const withPlatform: ClientToDirectoryFrame = { type: "activity-register", token: "tok", platform: "ios" }
    const rejected = [withTitle, missingRunning, missingToken, badEnvironment, withPlatform]
    expect(rejected).toHaveLength(5)
  })
})
