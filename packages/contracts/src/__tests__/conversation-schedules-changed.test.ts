import { describe, expect, it } from "vitest"

import { INITIAL_READ_MODEL_STATE, applyEvent } from "../event-reducers"

describe("conversation.schedules_changed reducer", () => {
  it("bumps conversationsListRevision and changes nothing else", () => {
    const initial = INITIAL_READ_MODEL_STATE
    const next = applyEvent(initial, {
      type: "conversation.schedules_changed",
      sequence: 1,
      timestamp: "2026-11-01T00:00:00Z",
      payload: { conversationName: "c" },
    })
    expect(next.conversationsListRevision).toBe(initial.conversationsListRevision + 1)
    expect(next).toEqual({ ...initial, conversationsListRevision: initial.conversationsListRevision + 1 })
  })
})
