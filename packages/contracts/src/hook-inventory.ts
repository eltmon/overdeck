export interface WiredHookInventoryEntry {
  readonly name: string
  readonly wired: true
  readonly color: `#${string}`
}

export interface UnwiredHookInventoryEntry {
  readonly name: string
  readonly wired: false
}

export type HookInventoryEntry = WiredHookInventoryEntry | UnwiredHookInventoryEntry

export const HOOK_INVENTORY = [
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
] as const satisfies readonly HookInventoryEntry[]

export type HookInventoryName = (typeof HOOK_INVENTORY)[number]["name"]

export const WIRED_HOOK_INVENTORY = HOOK_INVENTORY.filter((hook) => hook.wired)
export const WIRED_HOOK_NAMES = WIRED_HOOK_INVENTORY.map((hook) => hook.name)
