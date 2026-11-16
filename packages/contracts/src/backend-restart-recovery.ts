// Terminal-backend restart recovery (PAN-5091): the conversations that were
// live when the terminal backend went down and did not come back with it, and
// the state of the operator's Resume all run. A safe shutdown (PAN-5342) seeds
// the same offer with the agents and mid-turn conversations its drain stopped.
//
// Shared by the server (services/backend-restart-recovery.ts and its
// /api/backend-restart-recovery routes) and the frontend (the Needs-you card).

export interface BackendRestartConversation {
  readonly name: string
  readonly title: string | null
}

// A work agent a safe shutdown stopped (PAN-5342). Only `cause: "shutdown"` offers agents.
export interface BackendRestartAgent {
  readonly id: string
  readonly issueId: string | null
  readonly label: string
}

export type BackendRestartResumeOutcome = "resumed" | "already-running" | "skipped" | "failed"

export interface BackendRestartResumeResult {
  // The conversation name, or the agent id for an agent.
  readonly name: string
  readonly outcome: BackendRestartResumeOutcome
  // Why a conversation was skipped or why its resume failed.
  readonly reason?: string
}

export interface BackendRestartResumeRun {
  readonly state: "running" | "done"
  readonly startedAt: string // ISO
  readonly finishedAt: string | null // ISO
  // The conversation name or agent id being resumed now; null between resumes or when done.
  readonly current: string | null
  // True while the run waits for the resource governor (memory, PSI, CPU) to admit the next resume.
  readonly waitingForPressure: boolean
  readonly results: readonly BackendRestartResumeResult[]
}

export interface BackendRestartRecoverySnapshot {
  // ISO time the backend was seen going down; null when there is nothing to offer.
  readonly lostAt: string | null
  // What stopped them: a terminal-backend restart, or `pan shutdown` (PAN-5342).
  readonly cause: "backend-restart" | "shutdown"
  // The conversations Resume all would resume now.
  readonly conversations: readonly BackendRestartConversation[]
  // The agents Resume all would resume after the conversations. Empty unless cause is "shutdown".
  // No conversations and no agents means no Needs-you row.
  readonly agents: readonly BackendRestartAgent[]
  // The latest Resume all run, or null when none ran since the restart.
  readonly run: BackendRestartResumeRun | null
}
