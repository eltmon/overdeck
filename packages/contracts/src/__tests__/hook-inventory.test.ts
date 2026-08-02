import { describe, expect, it } from "vitest"
import { OVERDECK_HOOK_REGISTRATIONS } from "../../../../src/lib/claude-hooks-registration"
import { HOOK_INVENTORY, WIRED_HOOK_NAMES } from "../index"

const EXPECTED_HOOK_INVENTORY = [
  { name: "PreToolUse", wired: true, color: "#00d4ff" },
  { name: "PostToolUse", wired: true, color: "#39ff14" },
  { name: "PostToolUseFailure", wired: true, color: "#ff4444" },
  { name: "Stop", wired: true, color: "#ff2d7c" },
  { name: "SessionStart", wired: true, color: "#9d4edd" },
  { name: "Notification", wired: true, color: "#ffb800" },
  { name: "UserPromptSubmit", wired: true, color: "#00d4ff" },
  { name: "PreCompact", wired: true, color: "#ff7700" },
  { name: "PostCompact", wired: true, color: "#ff7700" },
  { name: "PermissionRequest", wired: true, color: "#ffb800" },
  { name: "SessionEnd", wired: false },
  { name: "SubagentStart", wired: false },
  { name: "SubagentStop", wired: false },
  { name: "StopFailure", wired: false },
  { name: "PermissionDenied", wired: false },
  { name: "TaskCreated", wired: false },
  { name: "TaskCompleted", wired: false },
  { name: "TeammateIdle", wired: false },
  { name: "ConfigChange", wired: false },
  { name: "WorktreeCreate", wired: false },
  { name: "InstructionsLoaded", wired: false },
] as const

describe("hook inventory", () => {
  it("exports all hooks in the Confluence HOOKBUS order", () => {
    expect(HOOK_INVENTORY).toEqual(EXPECTED_HOOK_INVENTORY)
  })

  it("keeps the wired inventory in exact parity with registered hook types", () => {
    const registeredHookTypes = [...new Set(
      OVERDECK_HOOK_REGISTRATIONS.map((registration) => registration.hookType),
    )].sort()

    expect([...WIRED_HOOK_NAMES].sort()).toEqual(registeredHookTypes)
  })
})
