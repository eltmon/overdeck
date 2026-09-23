import { describe, expect, it } from "vitest"
import {
  COMPANION_TERMINAL_CLOSE_BODY_KEYS,
  COMPANION_TERMINAL_OPEN_BODY_KEYS,
  companionTerminalKindFor,
} from "../index"

describe("companionTerminalKindFor", () => {
  it("maps OpenCode conversations to the native attach companion", () => {
    expect(companionTerminalKindFor({ harness: "opencode" })).toBe("opencode-attach")
  })

  it("maps Codex conversations to the native resume --remote companion", () => {
    expect(companionTerminalKindFor({ harness: "codex" })).toBe("codex-resume-remote")
  })

  it.each(["claude-code", "ohmypi", "pi", "acp", "kimi-code", "muse", null, undefined])(
    "keeps the owner pane as TERMINAL for harness %s",
    (harness) => {
      expect(companionTerminalKindFor({ harness })).toBeNull()
    },
  )
})

describe("companion terminal body whitelist", () => {
  it("accepts no caller-controlled target fields", () => {
    const targetKeys = ["url", "command", "sessionId", "session", "cwd", "dir", "target", "port", "binary"]
    for (const key of targetKeys) {
      expect(COMPANION_TERMINAL_OPEN_BODY_KEYS).not.toContain(key)
      expect(COMPANION_TERMINAL_CLOSE_BODY_KEYS).not.toContain(key)
    }
    expect(COMPANION_TERMINAL_CLOSE_BODY_KEYS).toEqual(["generation"])
  })
})
