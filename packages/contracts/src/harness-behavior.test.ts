import { describe, expect, it } from "vitest"

import { CLAUDE_CODE_BEHAVIOR, PRIME_AGENT_BEHAVIOR, getHarnessBehavior, getRuntimeBehavior } from "./harness-behavior"
import { KNOWN_HARNESSES } from "./types"

describe("PRIME_AGENT_BEHAVIOR", () => {
  it("getHarnessBehavior('prime-agent') returns PRIME_AGENT_BEHAVIOR, never the Claude fallback", () => {
    expect(getHarnessBehavior("prime-agent")).toBe(PRIME_AGENT_BEHAVIOR)
    expect(getHarnessBehavior("prime-agent")).not.toBe(CLAUDE_CODE_BEHAVIOR)
    expect(getRuntimeBehavior("prime-agent")).toBe(PRIME_AGENT_BEHAVIOR)
  })

  it("carries the Prime-specific kinds", () => {
    expect(PRIME_AGENT_BEHAVIOR.displayName).toBe("Prime Agent")
    expect(PRIME_AGENT_BEHAVIOR.launchCommandKind).toBe("prime-agent-host")
    expect(PRIME_AGENT_BEHAVIOR.deliveryKind).toBe("prime-agent-host-rpc")
    expect(PRIME_AGENT_BEHAVIOR.readinessKind).toBe("prime-agent-host-ready")
    expect(PRIME_AGENT_BEHAVIOR.transcriptKind).toBe("prime-agent-jsonl")
    expect(PRIME_AGENT_BEHAVIOR.sessionIdSource).toBe("prime-agent-session-id")
    expect(PRIME_AGENT_BEHAVIOR.contextLayerKind).toBe("prime-agent")
    expect(PRIME_AGENT_BEHAVIOR.feedKind).toBe("prime_agent")
    expect(PRIME_AGENT_BEHAVIOR.workAgentMode).toBe("prime-agent-host")
    expect(PRIME_AGENT_BEHAVIOR.supportsPtySupervisor).toBe(false)
  })

  it("no-loss: KNOWN_HARNESSES contains prime-agent and every harness has a dedicated behavior", () => {
    expect(KNOWN_HARNESSES.has("prime-agent")).toBe(true)
    const seen = new Set<string>()
    for (const harness of KNOWN_HARNESSES) {
      const behavior = getHarnessBehavior(harness as Parameters<typeof getHarnessBehavior>[0])
      if (harness !== "claude-code") expect(behavior).not.toBe(CLAUDE_CODE_BEHAVIOR)
      seen.add(behavior.displayName)
    }
    expect(seen.has("Prime Agent")).toBe(true)
  })
})
