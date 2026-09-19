import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { getHarness } from "./types"
import { DerivedIssueState } from "./derived-issue-state"
import { BackendPane } from "./backend-pane"

const decodeDerived = Schema.decodeUnknownSync(DerivedIssueState)
const encodeDerived = Schema.encodeSync(DerivedIssueState)
const decodePane = Schema.decodeUnknownSync(BackendPane)

describe("getHarness", () => {
  it("preserves the canonical ACP runtime literal", () => {
    expect(getHarness({ runtime: "acp" })).toBe("acp")
  })

  it("preserves the canonical kimi-code runtime literal", () => {
    expect(getHarness({ runtime: "kimi-code" })).toBe("kimi-code")
  })

  it("returns the existing target for every legacy harness string", () => {
    expect(getHarness({ runtime: "claude-code" })).toBe("claude-code")
    expect(getHarness({ runtime: "ohmypi" })).toBe("ohmypi")
    expect(getHarness({ runtime: "codex" })).toBe("codex")
    expect(getHarness({ runtime: "pi" })).toBe("ohmypi")
  })

  it("falls back to claude-code for unknown or missing runtime values", () => {
    expect(getHarness({ runtime: "not-a-harness" })).toBe("claude-code")
    expect(getHarness(undefined)).toBe("claude-code")
    expect(getHarness(null)).toBe("claude-code")
  })
})

describe("DerivedIssueState", () => {
  it("round-trips a full row", () => {
    const input = {
      issueId: "PAN-3917",
      state: "ready",
      attention: "needs-you",
      pr: { url: "https://github.com/o/r/pull/1", number: 1, reviewState: "approved", checks: "green", mergeable: true },
    }
    const decoded = decodeDerived(input)
    expect(decoded).toEqual(input)
    expect(encodeDerived(decoded)).toEqual(input)
  })

  it("decodes the minimal row and rejects an unknown state", () => {
    expect(decodeDerived({ issueId: "PAN-1", state: "backlog" })).toEqual({ issueId: "PAN-1", state: "backlog" })
    expect(() => decodeDerived({ issueId: "PAN-1", state: "verifying" })).toThrow()
  })

  it("accepts a null mergeable — the forge has not computed it yet", () => {
    const input = {
      issueId: "PAN-2",
      state: "in-review",
      pr: { url: "u", number: 2, reviewState: "none", checks: "pending", mergeable: null },
    }
    expect(decodeDerived(input)).toEqual(input)
  })
})

describe("BackendPane", () => {
  it("decodes a pane and rejects an unknown pane state", () => {
    const input = { id: "w1:p1", issue: "PAN-3917", role: "work", harness: "claude-code", model: "opus", state: "working" }
    expect(decodePane(input)).toEqual(input)
    expect(() => decodePane({ ...input, state: "running" })).toThrow()
  })
})
