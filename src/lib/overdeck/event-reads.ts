/** Canonical narrow read door for retained agent runtime events. */
import { getOverdeckDatabase } from './infra.js';

interface EventPayloadRow {
  payload: string | Record<string, unknown> | null;
}

export interface AgentRuntimeEventSession {
  id: string;
  startedAt: string;
}

export interface AgentRuntimeEventEvidence {
  agentId: string;
  issueId: string | null;
  role: string | null;
  workspace: string | null;
  model: string | null;
  branch: string | null;
  startedAt: string | null;
  sessions: AgentRuntimeEventSession[];
}

function parsePayload(payload: EventPayloadRow['payload']): Record<string, unknown> | null {
  if (payload && typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return null;
  const parsed = JSON.parse(payload) as unknown;
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
}

/**
 * Return the latest retained session id learned for one agent. Missing
 * claudeSessionId fields are skipped; an explicit null/empty value is a clear
 * tombstone and prevents an older id from being resurrected.
 */
export function readLatestAgentClaudeSessionIdEvent(agentId: string): string | null {
  const row = getOverdeckDatabase().prepare(`
    SELECT payload
    FROM events
    WHERE type = 'agent.model_set'
      AND json_extract(payload, '$.agentId') = ?
      AND json_type(payload, '$.claudeSessionId') IS NOT NULL
    ORDER BY sequence DESC
    LIMIT 1
  `).get(agentId) as EventPayloadRow | undefined;
  const payload = parsePayload(row?.payload ?? null);
  if (!payload) return null;
  const sessionId = payload['claudeSessionId'];
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  return sessionId.trim();
}

interface LifecycleRow {
  type: string;
  timestamp: number | string;
  status: string | null;
}

function eventMillis(timestamp: number | string): number {
  return typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
}

/**
 * PAN-5074: when the agent's stop is already recorded for its current launch,
 * the stop's epoch ms; otherwise null.
 *
 * Since PAN-3917 a deliberate stop (planning finalize, abort, wipe) is
 * recorded only as an `agent.status_changed` event to `stopped`; the
 * `state.json` status label stays `running`. That stop counts when it is the
 * agent's latest lifecycle event, is not deacon-lite's own death report (the
 * `agent.heartbeat_dead` + `agent.status_changed` pair, which must not hide a
 * later death), and is not older than the launch generation (`startedAt`,
 * `lastResumeAt`). `agent.stopped`, the supervisor's exit observation, is
 * neither a launch nor a deliberate stop and is skipped. `beforeSequence`
 * limits the read to events older than that sequence.
 */
export function readRecordedAgentStopAt(
  agent: { id: string; startedAt?: string; lastResumeAt?: string },
  opts: { beforeSequence?: number } = {},
): number | null {
  const rows = getOverdeckDatabase().prepare(`
    SELECT type, timestamp, json_extract(payload, '$.status') AS status
    FROM events
    WHERE type IN ('agent.started', 'agent.status_changed', 'agent.heartbeat_dead')
      AND json_extract(payload, '$.agentId') = ?
      AND (type <> 'agent.status_changed' OR json_extract(payload, '$.status') IN ('running', 'stopped'))
      AND sequence < ?
    ORDER BY sequence DESC
    LIMIT 2
  `).all(agent.id, opts.beforeSequence ?? Number.MAX_SAFE_INTEGER) as LifecycleRow[];
  const [latest, previous] = rows;
  if (latest?.type !== 'agent.status_changed' || latest.status !== 'stopped') return null;
  if (previous?.type === 'agent.heartbeat_dead') return null;
  const stoppedAt = eventMillis(latest.timestamp);
  if (!Number.isFinite(stoppedAt)) return null;
  const bounds = [Date.parse(agent.startedAt ?? ''), Date.parse(agent.lastResumeAt ?? '')].filter(Number.isFinite);
  return bounds.every((bound) => stoppedAt >= bound) ? stoppedAt : null;
}
