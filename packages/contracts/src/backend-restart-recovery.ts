// Terminal-backend restart recovery (PAN-5091): the conversations that were
// live when the terminal backend went down and did not come back with it, and
// the state of the operator's Resume all run.
//
// Shared by the server (services/backend-restart-recovery.ts and its
// /api/backend-restart-recovery routes) and the frontend (the Needs-you card).

export interface BackendRestartConversation {
  readonly name: string
  readonly title: string | null
}

export type BackendRestartResumeOutcome = "resumed" | "already-running" | "skipped" | "failed"

export interface BackendRestartResumeResult {
  readonly name: string
  readonly outcome: BackendRestartResumeOutcome
  // Why a conversation was skipped or why its resume failed.
  readonly reason?: string
}

export interface BackendRestartResumeRun {
  readonly state: "running" | "done"
  readonly startedAt: string // ISO
  readonly finishedAt: string | null // ISO
  // The conversation being resumed now; null between conversations or when done.
  readonly current: string | null
  // True while the run waits for the resource governor (memory, PSI, CPU) to admit the next resume.
  readonly waitingForPressure: boolean
  readonly results: readonly BackendRestartResumeResult[]
}

export interface BackendRestartRecoverySnapshot {
  // ISO time the backend was seen going down; null when there is nothing to offer.
  readonly lostAt: string | null
  // The conversations Resume all would resume now. Empty means no Needs-you row.
  readonly conversations: readonly BackendRestartConversation[]
  // The latest Resume all run, or null when none ran since the restart.
  readonly run: BackendRestartResumeRun | null
}
