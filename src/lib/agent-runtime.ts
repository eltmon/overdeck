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

import { Data, Effect } from 'effect'
import type {
  AgentRuntimeSnapshot,
  Activity,
  AgentResolution,
  ChannelReplyArtifactRef,
  ChannelReplyKind,
  WaitingReason,
} from '@panctl/contracts'

// Use 127.0.0.1 explicitly: when /etc/hosts resolves `localhost` to ::1
// (IPv6 first), Node's undici-based fetch() connects to [::1]:3011 and
// fails because the dashboard listens on the IPv4 wildcard 0.0.0.0.
// curl falls back to IPv4; Node's fetch in this version does not.
const DASHBOARD_URL = process.env['PANOPTICON_DASHBOARD_URL'] || 'http://127.0.0.1:3011'
const DEFAULT_TIMEOUT_MS = 1500

function abortSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms).unref?.()
  return controller.signal
}

class AgentRuntimeFetchError extends Data.TaggedError('AgentRuntimeFetchError')<{
  readonly url: string
  readonly cause?: unknown
}> {}

export const getAgentRuntimeSnapshot = (
  agentId: string,
): Effect.Effect<AgentRuntimeSnapshot | null> => {
  if (!agentId) return Effect.succeed(null)
  const url = `${DASHBOARD_URL}/api/agents/${encodeURIComponent(agentId)}/runtime`
  return Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () => fetch(url, { signal: abortSignal(DEFAULT_TIMEOUT_MS) }),
      catch: (cause) => new AgentRuntimeFetchError({ url, cause }),
    })
    if (!res.ok) return null
    const body = yield* Effect.tryPromise({
      try: () => res.json() as Promise<{ success: boolean; snapshot?: AgentRuntimeSnapshot }>,
      catch: (cause) => new AgentRuntimeFetchError({ url, cause }),
    })
    return body.success && body.snapshot ? body.snapshot : null
  }).pipe(Effect.orElseSucceed(() => null))
}

type HeartbeatBody =
  | { kind: 'activity'; activity: Activity; tool?: string }
  | { kind: 'thinking_start'; lastToolAt: string }
  | { kind: 'thinking_stop'; resolvedBy: 'tool' | 'waiting' | 'idle' | 'stopped' }
  | { kind: 'waiting_start'; reason: WaitingReason; message?: string }
  | { kind: 'waiting_clear'; clearedBy: 'user_response' | 'timeout' | 'stopped' | 'tool_resumed' }
  | { kind: 'message_received'; direction: 'to_agent' | 'from_agent'; source: 'user' | 'cloister' | 'specialist' | 'automated' }
  | { kind: 'channel_reply'; reply: { kind: ChannelReplyKind; summary: string; artifactRefs?: ChannelReplyArtifactRef[] } }
  | { kind: 'model_set'; model: string; claudeSessionId?: string }
  | { kind: 'resolution_set'; resolution: AgentResolution; resolutionCount: number }
  | { kind: 'current_issue_set'; currentIssue?: string }

/**
 * Emit a runtime event. Returns true if the dashboard accepted it, false on
 * any failure (timeout, network error, non-2xx). Callers get fire-and-forget
 * semantics — no retry, no buffering. The bash hooks have their own
 * pending-events.jsonl fallback; in-process callers just log and move on.
 */
export const emitAgentEvent = (
  agentId: string,
  body: HeartbeatBody,
): Effect.Effect<boolean> => {
  if (!agentId) return Effect.succeed(false)
  const url = `${DASHBOARD_URL}/api/agents/${encodeURIComponent(agentId)}/heartbeat`
  return Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, timestamp: new Date().toISOString() }),
          signal: abortSignal(DEFAULT_TIMEOUT_MS),
        }),
      catch: (cause) => new AgentRuntimeFetchError({ url, cause }),
    })
    return res.ok
  }).pipe(Effect.orElseSucceed(() => false))
}

// ─── Convenience wrappers mirroring the event taxonomy ────────────────────────

export const emitActivity = (
  agentId: string,
  activity: Activity,
  tool?: string,
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'activity', activity, tool })

export const emitWaitingStart = (
  agentId: string,
  reason: WaitingReason,
  message?: string,
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'waiting_start', reason, message })

export const emitWaitingClear = (
  agentId: string,
  clearedBy: 'user_response' | 'timeout' | 'stopped' | 'tool_resumed' = 'user_response',
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'waiting_clear', clearedBy })

export const emitModelSet = (
  agentId: string,
  model: string,
  claudeSessionId?: string,
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'model_set', model, claudeSessionId })

export const emitMessageReceived = (
  agentId: string,
  direction: 'to_agent' | 'from_agent',
  source: 'user' | 'cloister' | 'specialist' | 'automated',
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'message_received', direction, source })

export const emitChannelReply = (
  agentId: string,
  reply: { kind: ChannelReplyKind; summary: string; artifactRefs?: ChannelReplyArtifactRef[] },
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'channel_reply', reply })

export const emitResolution = (
  agentId: string,
  resolution: AgentResolution,
  resolutionCount: number,
): Effect.Effect<boolean> => emitAgentEvent(agentId, { kind: 'resolution_set', resolution, resolutionCount })
