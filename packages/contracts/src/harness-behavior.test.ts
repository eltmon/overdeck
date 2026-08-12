import { describe, expect, it } from "vitest"
import { getHarnessBehavior, getRuntimeBehavior, PRIME_AGENT_BEHAVIOR } from "./harness-behavior"

describe("Prime Agent harness behavior", () => {
  it("uses Prime-specific protocol discriminators", () => {
    expect(PRIME_AGENT_BEHAVIOR).toMatchObject({
      displayName: "Prime Agent",
      executableName: "prime-agent",
      processNames: ["prime-agent"],
      launchCommandKind: "prime-agent-rpc",
      deliveryKind: "prime-agent-rpc",
      readinessKind: "prime-agent-ready",
      transcriptKind: "prime-agent-jsonl",
      sessionIdSource: "prime-agent-session-id",
      contextLayerKind: "prime-agent",
      feedKind: "prime_agent",
      workAgentMode: "prime-agent-rpc",
      supportsPtySupervisor: false,
      supportsChannelsBridge: false,
      supportsConversationStreaming: true,
      supportsPatchProjection: false,
      usesRpcFifo: false,
      usesCodexHome: false,
      injectsPromptTimeMemory: true,
      readyTimeoutSeconds: 120,
    })
  })

  it("resolves without falling back to Claude Code", () => {
    expect(getHarnessBehavior("prime-agent")).toBe(PRIME_AGENT_BEHAVIOR)
    expect(getRuntimeBehavior("prime-agent")).toBe(PRIME_AGENT_BEHAVIOR)
  })
})
