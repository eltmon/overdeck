import { describe, expect, it } from "vitest"

import {
  CLAUDE_CODE_BEHAVIOR,
  PRIME_AGENT_BEHAVIOR,
  getHarnessBehavior,
  getRuntimeBehavior,
  isLegacyPiHarnessName,
  normalizeHarnessName,
  type RuntimeName,
} from "./harness-behavior"
import { HARNESS_CAPABILITY_KEYS } from "./harness-capabilities"
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

describe("steerKind (PAN-4292)", () => {
  it("Claude Code steers with its send-now keys", () => {
    expect(getHarnessBehavior("claude-code").steerKind).toBe("send-now-keys")
  })

  it("Pi (ohmypi and pi) steers over the control channel", () => {
    expect(getHarnessBehavior("ohmypi").steerKind).toBe("control-channel")
    expect(getHarnessBehavior("pi").steerKind).toBe("control-channel")
  })

  it("every other harness has no steer delivery", () => {
    for (const harness of ["codex", "acp", "opencode", "kimi-code", "muse", "prime-agent"] as const) {
      expect(getHarnessBehavior(harness).steerKind).toBeNull()
    }
  })
})

describe("HarnessCapabilities (PAN-4562)", () => {
  const RUNTIMES: readonly RuntimeName[] = ["claude-code", "ohmypi", "codex", "acp", "kimi-code", "opencode", "muse", "prime-agent"]

  it("every runtime declares every capability key with a defined value", () => {
    for (const runtime of RUNTIMES) {
      const capabilities = getRuntimeBehavior(runtime).capabilities
      expect(Object.keys(capabilities).sort()).toEqual([...HARNESS_CAPABILITY_KEYS].sort())
      for (const key of HARNESS_CAPABILITY_KEYS) expect(capabilities[key]).not.toBeUndefined()
    }
  })

  it("OpenCode declares its own capabilities, not ACP's", () => {
    const opencode = getRuntimeBehavior("opencode").capabilities
    expect(opencode).not.toBe(getRuntimeBehavior("acp").capabilities)
    expect(opencode.hostEffortFlag).toBe(true)
    expect(opencode.binaryConfigKey).toBeNull()
    expect(opencode.contextChannel).toBe("acp-initial-context")
  })

  it.each([
    ["claude-code", "append-system-prompt-file", false, false],
    ["ohmypi", "append-system-prompt", false, false],
    ["codex", "developer_instructions", false, false],
    ["acp", "acp-initial-context", true, true],
    ["kimi-code", "initial-message-envelope", true, true],
    ["opencode", "acp-initial-context", true, true],
    ["muse", "append-system-prompt-file", true, false],
    ["prime-agent", "prime-agent-append-system-prompt", true, true],
  ] as const)("%s declares contextChannel=%s stopRuntimeOnStartFailure=%s initialPromptMustLand=%s", (runtime, contextChannel, stopRuntimeOnStartFailure, initialPromptMustLand) => {
    const capabilities = getRuntimeBehavior(runtime).capabilities
    expect(capabilities.contextChannel).toBe(contextChannel)
    expect(capabilities.stopRuntimeOnStartFailure).toBe(stopRuntimeOnStartFailure)
    expect(capabilities.initialPromptMustLand).toBe(initialPromptMustLand)
  })
})

describe("normalizeHarnessName (PAN-4562)", () => {
  it("maps legacy pi to ohmypi, keeps known names, and rejects everything else", () => {
    expect(normalizeHarnessName("pi")).toBe("ohmypi")
    expect(normalizeHarnessName("codex")).toBe("codex")
    expect(normalizeHarnessName("claude")).toBeNull()
    expect(normalizeHarnessName(42)).toBeNull()
    expect(normalizeHarnessName(undefined)).toBeNull()
  })

  it("isLegacyPiHarnessName matches only the pi alias", () => {
    expect(isLegacyPiHarnessName("pi")).toBe(true)
    expect(isLegacyPiHarnessName("ohmypi")).toBe(false)
    expect(isLegacyPiHarnessName(undefined)).toBe(false)
  })

  it("getHarnessBehavior falls back to Claude Code for missing or unknown names", () => {
    expect(getHarnessBehavior(undefined)).toBe(CLAUDE_CODE_BEHAVIOR)
    expect(getHarnessBehavior("nope" as never)).toBe(CLAUDE_CODE_BEHAVIOR)
  })
})
