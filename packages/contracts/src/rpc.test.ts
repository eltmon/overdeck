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
})
