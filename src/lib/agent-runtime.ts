/**
 * PAN-800 — out-of-process client for the canonical AgentRuntimeSnapshot.
 *
 * Every caller that previously read/wrote ~/.panopticon/agents/<id>/runtime.json
 * now goes through this module. There is no file fallback: the dashboard's
 * AgentStateService (SubscriptionRef + projection_cache) is the single source
 * of truth. CLI and lib modules that need runtime state hit the HTTP API.
 * Server-reachable code inside the dashboard process yields AgentStateService
 * directly (zero-roundtrip) — this module is for everything else.
 */

import type { AgentRuntimeSnapshot, Activity, AgentResolution, WaitingReason } from '@panopticon/contracts'

const DASHBOARD_URL = process.env['PANOPTICON_DASHBOARD_URL'] || 'http://localhost:3011'
const DEFAULT_TIMEOUT_MS = 1500

async function withTimeout<T>(p: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await p
  } finally {
    clearTimeout(timer)
  }
}

export async function getAgentRuntimeSnapshot(
  agentId: string,
): Promise<AgentRuntimeSnapshot | null> {
  if (!agentId) return null
  const url = `${DASHBOARD_URL}/api/agents/${encodeURIComponent(agentId)}/runtime`
  try {
    const res = await withTimeout(fetch(url))
    if (!res.ok) return null
    const body = (await res.json()) as { success: boolean; snapshot?: AgentRuntimeSnapshot }
    return body.success && body.snapshot ? body.snapshot : null
  } catch {
    return null
  }
}

type HeartbeatBody =
  | { kind: 'activity'; activity: Activity; tool?: string }
  | { kind: 'thinking_start'; lastToolAt: string }
  | { kind: 'thinking_stop'; resolvedBy: 'tool' | 'waiting' | 'idle' | 'stopped' }
  | { kind: 'waiting_start'; reason: WaitingReason; message?: string }
  | { kind: 'waiting_clear'; clearedBy: 'user_response' | 'timeout' | 'stopped' | 'tool_resumed' }
  | { kind: 'message_received'; direction: 'to_agent' | 'from_agent'; source: 'user' | 'cloister' | 'specialist' | 'automated' }
  | { kind: 'model_set'; model: string; claudeSessionId?: string }
  | { kind: 'resolution_set'; resolution: AgentResolution; resolutionCount: number }
  | { kind: 'current_issue_set'; currentIssue?: string }

/**
 * Emit a runtime event. Returns true if the dashboard accepted it, false on
 * any failure (timeout, network error, non-2xx). Callers get fire-and-forget
 * semantics — no retry, no buffering. The bash hooks have their own
 * pending-events.jsonl fallback; in-process callers just log and move on.
 */
export async function emitAgentEvent(agentId: string, body: HeartbeatBody): Promise<boolean> {
  if (!agentId) return false
  const url = `${DASHBOARD_URL}/api/agents/${encodeURIComponent(agentId)}/heartbeat`
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, timestamp: new Date().toISOString() }),
      }),
    )
    return res.ok
  } catch {
    return false
  }
}

// ─── Convenience wrappers mirroring the event taxonomy ────────────────────────

export const emitActivity = (
  agentId: string,
  activity: Activity,
  tool?: string,
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'activity', activity, tool })

export const emitWaitingStart = (
  agentId: string,
  reason: WaitingReason,
  message?: string,
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'waiting_start', reason, message })

export const emitWaitingClear = (
  agentId: string,
  clearedBy: 'user_response' | 'timeout' | 'stopped' | 'tool_resumed' = 'user_response',
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'waiting_clear', clearedBy })

export const emitModelSet = (
  agentId: string,
  model: string,
  claudeSessionId?: string,
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'model_set', model, claudeSessionId })

export const emitMessageReceived = (
  agentId: string,
  direction: 'to_agent' | 'from_agent',
  source: 'user' | 'cloister' | 'specialist' | 'automated',
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'message_received', direction, source })

export const emitResolution = (
  agentId: string,
  resolution: AgentResolution,
  resolutionCount: number,
): Promise<boolean> => emitAgentEvent(agentId, { kind: 'resolution_set', resolution, resolutionCount })
