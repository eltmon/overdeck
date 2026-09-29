import { describe, expect, it } from "vitest"

import { indexPanesByAgentKey, paneAgentKey, type BackendPane } from "../backend-pane"

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: "wKZ:p3",
    role: "work",
    harness: "claude-code",
    model: "claude-sonnet-5",
    state: "working",
    ...overrides,
  }
}

describe("paneAgentKey", () => {
  it("prefers agentId over terminalId and id", () => {
    const p = pane({ id: "wKZ:p3", terminalId: "term_65c8b78d3f05a5df", agentId: "agent-pan-4311" })
    expect(paneAgentKey(p)).toBe("agent-pan-4311")
  })

  it("falls back to terminalId when agentId is absent", () => {
    const p = pane({ id: "wKZ:p3", terminalId: "term_65c8b78d3f05a5df", agentId: undefined })
    expect(paneAgentKey(p)).toBe("term_65c8b78d3f05a5df")
  })

  it("falls back to id when neither agentId nor terminalId is present", () => {
    const p = pane({ id: "wKZ:p3", terminalId: undefined, agentId: undefined })
    expect(paneAgentKey(p)).toBe("wKZ:p3")
  })
})

describe("indexPanesByAgentKey", () => {
  it("keeps the live pane when the exited pane comes first", () => {
    const exited = pane({ id: "wKZ:p1", agentId: "agent-pan-4311", state: "exited" })
    const live = pane({ id: "wKZ:p2", agentId: "agent-pan-4311", state: "working" })
    const index = indexPanesByAgentKey([exited, live])
    expect(index.get("agent-pan-4311")).toBe(live)
  })

  it("keeps the live pane when the live pane comes first", () => {
    const exited = pane({ id: "wKZ:p1", agentId: "agent-pan-4311", state: "exited" })
    const live = pane({ id: "wKZ:p2", agentId: "agent-pan-4311", state: "working" })
    const index = indexPanesByAgentKey([live, exited])
    expect(index.get("agent-pan-4311")).toBe(live)
  })

  it("keeps the exited pane when it is the only pane for the agent", () => {
    const exited = pane({ id: "wKZ:p1", agentId: "agent-pan-4311", state: "exited" })
    const index = indexPanesByAgentKey([exited])
    expect(index.get("agent-pan-4311")).toBe(exited)
  })
})
