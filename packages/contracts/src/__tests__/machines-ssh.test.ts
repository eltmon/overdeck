import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { MachineLinkView, SSH_MACHINE_ERROR_CODES, SshTestResult } from "../machines"

const view = {
  id: "link_1",
  environmentId: "env_0123456789abcdef",
  label: "vps",
  fingerprint: "aaaa-bbbb-cccc-dddd-eeee",
  access: "operator",
  state: "online",
  stateDetail: null,
  currentRoute: "tcp://127.0.0.1:41234",
  routes: [{ url: "tcp://127.0.0.1:41234", kind: "ssh", source: "pairing", status: "current" }],
  lastHeartbeatAt: null,
  incident: null,
  peerVersion: "0.72.0",
  createdAt: "2026-11-01T00:00:00.000Z",
}

const ssh = {
  destination: "me@vps.example",
  launch: "managed",
  forward: "up",
  forwardDetail: null,
  localPort: 41234,
  remotePort: 3011,
}

describe("MachineLinkView ssh block", () => {
  it("decodes a view without an ssh field", () => {
    const decoded = Schema.decodeUnknownSync(MachineLinkView)(view)
    expect(decoded.ssh).toBeUndefined()
  })

  it("decodes a view with a complete ssh block", () => {
    const decoded = Schema.decodeUnknownSync(MachineLinkView)({ ...view, ssh })
    expect(decoded.ssh).toEqual(ssh)
  })

  it("rejects an unknown forward state", () => {
    expect(() =>
      Schema.decodeUnknownSync(MachineLinkView)({ ...view, ssh: { ...ssh, forward: "broken" } }),
    ).toThrow()
  })
})

describe("SSH machine error codes", () => {
  it("lists exactly the 13 codes of D-4404-9", () => {
    expect([...SSH_MACHINE_ERROR_CODES].sort()).toEqual(
      [
        "bad-destination",
        "busy",
        "unresolvable",
        "unreachable",
        "host-key",
        "auth-failed",
        "pan-missing",
        "version-mismatch",
        "helper-failed",
        "start-failed",
        "forward-failed",
        "self-link",
        "not-found",
      ].sort(),
    )
  })

  it("accepts only those codes in an SshTestResult", () => {
    const result = {
      reachable: false,
      panVersion: null,
      localVersion: "0.72.0",
      versionMatches: false,
      error: "auth-failed",
      message: "Permission denied (publickey).",
    }
    expect(Schema.decodeUnknownSync(SshTestResult)(result)).toEqual(result)
    expect(() => Schema.decodeUnknownSync(SshTestResult)({ ...result, error: "nope" })).toThrow()
  })
})
