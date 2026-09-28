/**
 * Conversation-row classifiers shared by the dashboard server (`src/lib`) and
 * the frontend (PAN-4301). One rule per question: which rows are singleton
 * runners, and what a lane conversation is doing right now (D10).
 */

/** Singleton runners spawn under their bare id (see src/lib/agents/identity.ts normalizeAgentId). */
export const SINGLETON_AGENT_IDS: ReadonlySet<string> = new Set(["flywheel-orchestrator", "sequencer-runner"])

export function isSingletonConversation(row: { name: string; issueId?: string | null }): boolean {
  return SINGLETON_AGENT_IDS.has(row.name.toLowerCase())
    || (row.issueId != null && SINGLETON_AGENT_IDS.has(row.issueId.toLowerCase()))
}

export type LaneActivity = "failed-to-start" | "needs-you" | "working" | "idle" | "starting" | "stopped"

/** D10 `starting`: not alive, not ended, created less than this long ago. */
export const LANE_STARTING_GRACE_MS = 3 * 60_000

export interface LaneActivityInput {
  archivedAt?: string | null
  spawnError?: string | null
  status?: "active" | "ended" | string | null
  createdAt: string
  sessionAlive?: boolean
  isWorking?: boolean
  pendingInputCount?: number
}

/** D10, first match wins. */
export function laneActivityOf(row: LaneActivityInput, now: number): LaneActivity {
  if (row.archivedAt != null) return "stopped"
  if (row.spawnError) return "failed-to-start"
  if (row.sessionAlive) {
    if ((row.pendingInputCount ?? 0) > 0) return "needs-you"
    if (row.isWorking) return "working"
    return "idle"
  }
  if (row.status === "active" && now - Date.parse(row.createdAt) < LANE_STARTING_GRACE_MS) return "starting"
  return "stopped"
}
