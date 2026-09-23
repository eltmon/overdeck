import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AgentDirectoryResponse, DirectoryEntry } from "./agent-directory"

const decodeEntry = Schema.decodeUnknownSync(DirectoryEntry)
const decodeResponse = Schema.decodeUnknownSync(AgentDirectoryResponse)

const entry = {
  id: "agent-pan-3920",
  kind: "agent",
  label: "work · PAN-3920",
  location: "local",
  projectKey: "overdeck",
  issueId: "PAN-3920",
  parentId: null,
  role: "work",
  harness: "claude-code",
  model: "claude-opus-4-7",
  state: "working",
  startedAt: "2026-09-23T10:00:00.000Z",
  lastActivityAt: "2026-09-23T10:05:00.000Z",
  costUsd: null,
  source: "overdeck",
  transcript: { route: "agent", agentId: "agent-pan-3920" },
}

describe("DirectoryEntry", () => {
  it("decodes a full entry", () => {
    expect(decodeEntry(entry)).toEqual(entry)
    const response = decodeResponse({ generatedAt: "2026-09-23T10:06:00.000Z", windowHours: 24, entries: [entry] })
    expect(response.entries).toHaveLength(1)
  })

  it("decodes every transcript ref shape", () => {
    for (const transcript of [
      { route: "agent-subagent", agentId: "agent-pan-1", subagentId: "a1" },
      { route: "conversation", conversationName: "fix-bug" },
      { route: "conversation-subagent", conversationName: "fix-bug", subagentId: "a1" },
      null,
    ]) {
      expect(decodeEntry({ ...entry, transcript }).transcript).toEqual(transcript)
    }
  })

  it("rejects an unknown state", () => {
    expect(() => decodeEntry({ ...entry, state: "running" })).toThrow()
  })
})
