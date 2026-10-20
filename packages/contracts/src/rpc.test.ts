import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  ConversationEvent,
  ConversationResponse,
  SubscribeConversationMessagesRpc,
} from "./rpc"

const subagent = {
  agentId: "a1b2c3",
  agentType: "Explore",
  description: "Trace conversation message handling",
  toolUseId: "toolu_123",
  spawnDepth: 1,
  status: "running",
} as const

describe("ConversationEvent", () => {
  it("decodes a subagents event", () => {
    const event = {
      kind: "subagents",
      subagents: [subagent],
    }

    expect(Schema.decodeUnknownSync(ConversationEvent)(event)).toEqual(event)
  })

  it("decodes a windowed messages snapshot with elided tool bodies (PAN-4558)", () => {
    const event = {
      kind: "messages",
      messages: [],
      workLog: [{
        id: "toolu_1",
        createdAt: "2026-10-19T00:00:00.000Z",
        label: "Read",
        tone: "tool",
        resultBytes: 10240,
        bodyOmitted: true,
      }],
      streaming: false,
      snapshot: true,
      window: { cursor: '["2026-10-19T00:00:00.000Z",3,1,"toolu_1"]', hasOlder: true, transcript: "2049:123" },
    }

    expect(Schema.decodeUnknownSync(ConversationEvent)(event)).toEqual(event)
  })

  it("decodes a window whose cursor is null", () => {
    const event = {
      kind: "messages",
      messages: [],
      workLog: [],
      streaming: false,
      window: { cursor: null, hasOlder: false },
    }

    expect(Schema.decodeUnknownSync(ConversationEvent)(event)).toEqual(event)
  })
})

describe("SubscribeConversationMessagesRpc", () => {
  const decodePayload = Schema.decodeUnknownSync(SubscribeConversationMessagesRpc.payloadSchema)

  it("decodes payloads with and without an agent id", () => {
    expect(decodePayload({ conversationName: "conv-123" })).toEqual({
      conversationName: "conv-123",
    })
    expect(decodePayload({ conversationName: "conv-123", agentId: "a1b2c3" })).toEqual({
      conversationName: "conv-123",
      agentId: "a1b2c3",
    })
  })

  it("decodes a resume payload (PAN-4558)", () => {
    const payload = {
      conversationName: "conv-123",
      resume: { afterSequence: 42, openIds: ["toolu_1"], transcript: "2049:123" },
    }

    expect(decodePayload(payload)).toEqual(payload)
  })

  it("rejects a resume payload without a transcript id", () => {
    expect(() => decodePayload({
      conversationName: "conv-123",
      resume: { afterSequence: 42, openIds: [] },
    })).toThrow()
  })
})

describe("ConversationResponse", () => {
  const decodeResponse = Schema.decodeUnknownSync(ConversationResponse)
  const legacyResponse = {
    messages: [],
    workLog: [],
    streaming: false,
    totalCost: 0,
    byteOffset: 0,
  }

  it("decodes responses with and without subagents", () => {
    expect(decodeResponse(legacyResponse)).toEqual(legacyResponse)
    expect(decodeResponse({ ...legacyResponse, subagents: [subagent] })).toEqual({
      ...legacyResponse,
      subagents: [subagent],
    })
  })

  it("decodes a paged response with a window (PAN-4558)", () => {
    const paged = { ...legacyResponse, window: { cursor: '["a",0,0,"m1"]', hasOlder: false, transcript: "2049:123" } }

    expect(decodeResponse(paged)).toEqual(paged)
  })
})
