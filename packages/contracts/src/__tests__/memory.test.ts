import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { MemoryIdentity, MemoryObservation } from "../memory"

function baseIdentity() {
  return {
    projectId: "overdeck",
    workspaceId: "workspace-1",
    issueId: null as string | null,
    runId: "run-1",
    sessionId: "session-1",
    agentRole: "work",
    agentHarness: "claude-code",
  }
}

function baseObservation() {
  return {
    id: "obs-1",
    timestamp: "2026-07-28T00:00:00.000Z",
    projectId: "overdeck",
    workspaceId: "workspace-1",
    issueId: null as string | null,
    runId: "run-1",
    sessionId: "session-1",
    agentRole: "work",
    agentHarness: "claude-code",
    gitBranch: "main",
    sourceTranscriptOffset: 0,
    actionStatus: null,
    narrative: "did a thing",
    summary: "did a thing",
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: "claude-sonnet-5",
  }
}

describe("MemoryIdentity (PAN-1990)", () => {
  it("decodes with issueId: null (main/scratch workspace turn)", () => {
    const decoded = Schema.decodeUnknownSync(MemoryIdentity)(baseIdentity())
    expect(decoded.issueId).toBeNull()
  })

  it("still decodes with a real issueId", () => {
    const decoded = Schema.decodeUnknownSync(MemoryIdentity)({ ...baseIdentity(), issueId: "PAN-1990" })
    expect(decoded.issueId).toBe("PAN-1990")
  })
})

describe("MemoryObservation (PAN-1990)", () => {
  it("decodes with issueId: null (main/scratch workspace turn)", () => {
    const decoded = Schema.decodeUnknownSync(MemoryObservation)(baseObservation())
    expect(decoded.issueId).toBeNull()
  })

  it("still decodes with a real issueId", () => {
    const decoded = Schema.decodeUnknownSync(MemoryObservation)({ ...baseObservation(), issueId: "PAN-1990" })
    expect(decoded.issueId).toBe("PAN-1990")
  })
})
