import { describe, expect, it } from "vitest"

import type { ChatMessage } from "../rpc"
import type { SharedEnvelope, SharedHello } from "../sharing"
import {
  SHARE_MAX_ENVELOPE_CHARS,
  SHARE_MAX_INBOUND_ENVELOPE_CHARS,
  SHARE_MAX_MESSAGE_CHARS,
  SHARED_PROMPT_MAX_CHARS,
  SeqTracker,
  SharedChannelReader,
  decodeEnvelope,
  encodeSharedMessage,
  negotiateHello,
  readDraftPayload,
  sharedPromptRefusal,
  toSharedMessage,
} from "../sharing-wire"

function envelope(payload: unknown, overrides: Partial<SharedEnvelope> = {}): SharedEnvelope {
  return { v: 1, ch: "conversation", streamId: "conv-a", seq: 1, t: 1_700_000_000_000, payload, ...overrides }
}

function readAll(parts: readonly string[]) {
  const reader = new SharedChannelReader()
  return parts.map((part) => reader.read(part))
}

describe("toSharedMessage", () => {
  it("copies exactly the allow-listed keys and drops everything else", () => {
    const input = {
      id: "m1",
      role: "assistant",
      text: "hi",
      createdAt: "2026-11-03T00:00:00Z",
      turnId: "t1",
      completedAt: "2026-11-03T00:00:01Z",
      streaming: false,
      sequence: 4,
      secret: "x",
      rawContent: [1],
      author: { login: "evil", avatarUrl: "x" },
    } as unknown as ChatMessage
    const shared = toSharedMessage(input)
    expect(Object.keys(shared).sort()).toEqual([
      "completedAt",
      "createdAt",
      "id",
      "role",
      "sequence",
      "streaming",
      "text",
      "turnId",
    ])
    expect(shared).toMatchObject({ id: "m1", role: "assistant", text: "hi", turnId: "t1", sequence: 4, streaming: false })
  })

  it("returns only the four required keys for a minimal message", () => {
    const shared = toSharedMessage({ id: "m1", role: "user", text: "hello", createdAt: "2026-11-03T00:00:00Z" })
    expect(Object.keys(shared).sort()).toEqual(["createdAt", "id", "role", "text"])
  })

  it("drops an optional field of the wrong type", () => {
    const shared = toSharedMessage({
      id: "m1",
      role: "user",
      text: "hello",
      createdAt: "2026-11-03T00:00:00Z",
      streaming: "yes",
    } as unknown as ChatMessage)
    expect(Object.keys(shared)).not.toContain("streaming")
  })
})

describe("decodeEnvelope", () => {
  it("round-trips a valid envelope with exactly six keys", () => {
    const value = envelope({ kind: "history", messages: [] })
    const decoded = decodeEnvelope(JSON.parse(JSON.stringify(value)))
    expect(decoded).toEqual(value)
    expect(Object.keys(decoded ?? {}).sort()).toEqual(["ch", "payload", "seq", "streamId", "t", "v"])
  })

  it("drops an extra key", () => {
    const decoded = decodeEnvelope({ ...envelope(null), extra: "x" })
    expect(decoded).not.toBeNull()
    expect(Object.keys(decoded ?? {})).not.toContain("extra")
  })

  it.each([
    ["seq 0", { seq: 0 }],
    ["fractional seq", { seq: 1.5 }],
    ["unknown channel", { ch: "video" }],
    ["empty streamId", { streamId: "" }],
  ])("rejects %s", (_name, overrides) => {
    expect(decodeEnvelope({ ...envelope(null), ...overrides })).toBeNull()
  })

  it("rejects a missing payload", () => {
    const { payload: _payload, ...rest } = envelope(null)
    expect(decodeEnvelope(rest)).toBeNull()
  })
})

describe("encodeSharedMessage and SharedChannelReader", () => {
  it("sends a small envelope as one message that reads back equal", () => {
    const value = envelope({ kind: "append", message: { id: "m1" } })
    const parts = encodeSharedMessage(value, 1)
    expect(parts).toHaveLength(1)
    expect(readAll(parts)).toEqual([{ kind: "envelope", envelope: value }])
  })

  it("fragments a long envelope and reassembles it after the last part", () => {
    const value = envelope({ kind: "append", message: { id: "m1", text: "a".repeat(100_000) } })
    const length = JSON.stringify(value).length
    const parts = encodeSharedMessage(value, 7)
    expect(parts).toHaveLength(Math.ceil(length / SHARE_MAX_MESSAGE_CHARS))
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(SHARE_MAX_MESSAGE_CHARS + 200)
    const results = readAll(parts)
    for (const result of results.slice(0, -1)) expect(result).toEqual({ kind: "pending" })
    expect(results.at(-1)).toEqual({ kind: "envelope", envelope: value })
  })

  it("keeps surrogate pairs intact across fragment boundaries", () => {
    const value = envelope({ kind: "append", message: { id: "m1", text: "😀".repeat(40_000) } })
    const parts = encodeSharedMessage(value, 2)
    expect(parts.length).toBeGreaterThan(1)
    expect(readAll(parts).at(-1)).toEqual({ kind: "envelope", envelope: value })
  })

  it("reports a fragment that does not start at index 0 as out of order", () => {
    const parts = encodeSharedMessage(envelope({ text: "a".repeat(100_000) }), 3)
    expect(new SharedChannelReader().read(parts[1] ?? "")).toEqual({ kind: "invalid", reason: "chunk_out_of_order" })
  })

  it("drops the partial buffer when a fragment arrives out of order", () => {
    const parts = encodeSharedMessage(envelope({ text: "a".repeat(100_000) }), 3)
    const reader = new SharedChannelReader()
    expect(reader.read(parts[0] ?? "")).toEqual({ kind: "pending" })
    expect(reader.read(parts[2] ?? "")).toEqual({ kind: "invalid", reason: "chunk_out_of_order" })
    expect(reader.read(parts[1] ?? "")).toEqual({ kind: "invalid", reason: "chunk_out_of_order" })
  })

  it("throws RangeError for an envelope over the limit", () => {
    const value = envelope({ text: "a".repeat(SHARE_MAX_ENVELOPE_CHARS) })
    expect(() => encodeSharedMessage(value, 1)).toThrow(RangeError)
  })

  it("rejects a fragment whose count exceeds the envelope limit", () => {
    const count = SHARE_MAX_ENVELOPE_CHARS / SHARE_MAX_MESSAGE_CHARS + 2
    const fragment = JSON.stringify({ v: 1, chunk: { id: 1, index: 0, count }, data: "x" })
    expect(new SharedChannelReader().read(fragment)).toEqual({ kind: "invalid", reason: "too_large" })
  })

  it("reports text that is not JSON", () => {
    expect(new SharedChannelReader().read("{")).toEqual({ kind: "invalid", reason: "not_json" })
  })

  it("reports JSON that is not an envelope", () => {
    expect(new SharedChannelReader().read(JSON.stringify({ hello: 1 }))).toEqual({ kind: "invalid", reason: "not_envelope" })
  })
})

describe("SeqTracker", () => {
  it("reports a gap once and tracks streams independently", () => {
    const tracker = new SeqTracker()
    expect(tracker.observe("conversation", "a", 1)).toEqual({ ok: true })
    expect(tracker.observe("conversation", "a", 2)).toEqual({ ok: true })
    expect(tracker.observe("conversation", "a", 3)).toEqual({ ok: true })
    expect(tracker.observe("conversation", "a", 5)).toEqual({ ok: false, expected: 4, got: 5 })
    expect(tracker.observe("conversation", "a", 6)).toEqual({ ok: true })
    expect(tracker.observe("conversation", "b", 1)).toEqual({ ok: true })
    expect(tracker.observe("presence", "a", 1)).toEqual({ ok: true })
  })
})

describe("negotiateHello", () => {
  const local: SharedHello = { v: 1, scopeKinds: ["conversation"], scope: { kind: "conversation", conversationId: "conv-a" } }

  it("agrees on equal hellos", () => {
    expect(negotiateHello(local, { ...local })).toEqual({ ok: true, v: 1 })
  })

  it("agrees on the lower version", () => {
    expect(negotiateHello(local, { ...local, v: 2 })).toEqual({ ok: true, v: 1 })
  })

  it.each([0, "1"])("rejects remote v %j as invalid", (v) => {
    expect(negotiateHello(local, { ...local, v })).toEqual({ ok: false, code: "invalid_hello" })
  })

  it("rejects a remote that supports no scope kinds", () => {
    expect(negotiateHello(local, { ...local, scopeKinds: [] })).toEqual({ ok: false, code: "scope_kind_unsupported" })
  })

  it("rejects a remote scope kind the local side does not support", () => {
    const remote = { v: 1, scopeKinds: ["task"], scope: { kind: "task", conversationId: "conv-a" } }
    expect(negotiateHello(local, remote)).toEqual({ ok: false, code: "scope_kind_unsupported" })
  })

  it("rejects a different conversation as invalid", () => {
    const remote = { ...local, scope: { kind: "conversation", conversationId: "conv-b" } }
    expect(negotiateHello(local, remote)).toEqual({ ok: false, code: "invalid_hello" })
  })

  it("rejects null as invalid", () => {
    expect(negotiateHello(local, null)).toEqual({ ok: false, code: "invalid_hello" })
  })
})

describe("sharedPromptRefusal", () => {
  it.each(["", "   ", "/pan status", "  !ls", "# notes"])("refuses %j as invalid_prompt", (text) => {
    expect(sharedPromptRefusal(text)).toBe("invalid_prompt")
  })

  it("refuses a prompt longer than the cap as too_long", () => {
    expect(sharedPromptRefusal("a".repeat(SHARED_PROMPT_MAX_CHARS + 1))).toBe("too_long")
    expect(sharedPromptRefusal("a".repeat(SHARED_PROMPT_MAX_CHARS))).toBeNull()
  })

  it.each(["Fix the bug", "see /tmp/x"])("accepts %j", (text) => {
    expect(sharedPromptRefusal(text)).toBeNull()
  })
})

describe("readDraftPayload", () => {
  const draft = { authorGithubId: 7, authorLogin: "alice", text: "hi", updatedAt: 1_700_000_000_000 }

  it("rebuilds a draft from its known keys and drops extra keys", () => {
    expect(readDraftPayload({ ...draft, avatarUrl: "javascript:x" })).toEqual(draft)
  })

  it("rejects a non-positive author id, a missing text and an over-long text", () => {
    expect(readDraftPayload({ ...draft, authorGithubId: 0 })).toBeNull()
    const { text: _text, ...withoutText } = draft
    expect(readDraftPayload(withoutText)).toBeNull()
    expect(readDraftPayload({ ...draft, text: "a".repeat(SHARED_PROMPT_MAX_CHARS + 1) })).toBeNull()
  })

  it("rejects a non-finite updatedAt and a non-object", () => {
    expect(readDraftPayload({ ...draft, updatedAt: Number.NaN })).toBeNull()
    expect(readDraftPayload("hi")).toBeNull()
  })
})

describe("SharedChannelReader inbound cap", () => {
  it("returns too_large for an unfragmented message longer than the cap", () => {
    const reader = new SharedChannelReader(100)
    const text = JSON.stringify(envelope({ text: "a".repeat(200) }))
    expect(text.length).toBeGreaterThan(100)
    expect(reader.read(text)).toEqual({ kind: "invalid", reason: "too_large" })
    const exact = JSON.stringify(envelope({ text: "" }))
    expect(new SharedChannelReader(exact.length).read(exact)).toEqual({ kind: "envelope", envelope: envelope({ text: "" }) })
    expect(new SharedChannelReader(exact.length - 1).read(exact)).toEqual({ kind: "invalid", reason: "too_large" })
  })

  it("refuses a message too long to be an envelope or a fragment before parsing it", () => {
    const reader = new SharedChannelReader(SHARE_MAX_INBOUND_ENVELOPE_CHARS)
    // Not JSON: a parse would report not_json, so too_large proves the length check came first.
    expect(reader.read("{".repeat(SHARE_MAX_MESSAGE_CHARS * 6 + 1_000))).toEqual({ kind: "invalid", reason: "too_large" })
    expect(reader.read("{".repeat(1_000))).toEqual({ kind: "invalid", reason: "not_json" })
  })

  it("still reads a fragment whose escaped data is longer than the inbound cap", () => {
    // A quote is `\"` in the envelope and `\\\"` in the fragment, so each fragment roughly doubles.
    const value = envelope({ text: '"'.repeat(40_000) })
    const parts = encodeSharedMessage(value, 9)
    expect(parts.some((part) => part.length > SHARE_MAX_INBOUND_ENVELOPE_CHARS)).toBe(true)
    expect(readAll(parts).at(-1)).toEqual({ kind: "envelope", envelope: value })
  })

  it("returns too_large for fragments whose count passes the cap", () => {
    const parts = encodeSharedMessage(envelope({ text: "a".repeat(100_000) }), 4)
    expect(new SharedChannelReader(100).read(parts[0] ?? "")).toEqual({ kind: "invalid", reason: "too_large" })
    expect(new SharedChannelReader(SHARE_MAX_INBOUND_ENVELOPE_CHARS).read(parts[0] ?? "")).toEqual({ kind: "invalid", reason: "too_large" })
  })

  it("still reassembles a 100,000-character envelope with the default cap", () => {
    const value = envelope({ text: "a".repeat(100_000) })
    expect(readAll(encodeSharedMessage(value, 5)).at(-1)).toEqual({ kind: "envelope", envelope: value })
  })
})
