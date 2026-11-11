// Harness CLI auto-update snapshot (PAN-5108): the background updater's state
// and the npm-based CLIs whose last daily update failed.
//
// Shared by the server (the harness auto-update service and its
// GET /api/harness-auto-update route) and the frontend (the desktop Needs-you
// card and the phone line).

export type HarnessAutoUpdateOutcomeKind = "updated" | "current" | "skipped" | "failed"

export interface HarnessAutoUpdateFailure {
  readonly binary: string // e.g. "claude"
  readonly label: string // e.g. "Claude Code"
  readonly error: string // output tail, at most 2000 characters
  readonly command: string // the update plan's display, for a manual update
  readonly failedAt: string // ISO
}

export interface HarnessAutoUpdateSnapshot {
  readonly enabled: boolean | null // null before the first pass
  readonly running: boolean
  readonly lastRunAt: string | null // ISO, end of the last pass
  readonly nextRunAt: string | null // ISO
  readonly failures: readonly HarnessAutoUpdateFailure[]
}
