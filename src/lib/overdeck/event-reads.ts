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

/** How many lifecycle rows to read back past deacon-lite's own death reports. */
const LIFECYCLE_LOOKBACK_ROWS = 8;

/**
 * PAN-5074: when the agent's end is already recorded for its current launch,
 * the epoch ms it was recorded; otherwise null.
 *
 * Since PAN-3917 a deliberate stop (planning finalize, an operator stop or
 * pause) is recorded only as an `agent.status_changed` event to `stopped`;
 * the `state.json` status label stays `running`. Such a stop counts when it
 * is the latest lifecycle event once deacon-lite's own death reports
 * (`agent.heartbeat_dead`, alone or followed by `agent.status_changed` to
 * `stopped`) are read past. A report never hides an earlier stop. With
 * `reports`, a report counts too when it is not older than `reports.notBefore`
 * (when the caller last saw the agent alive), so a deacon restart does not
 * report the same death again. Every counted event must also be at or after
 * the launch generation (`startedAt`, `lastResumeAt`).
 *
 * `agent.stopped` is skipped: the supervisor writes it when a harness exits,
 * a crash included, so it must not silence a death. `beforeSequence` limits
 * the read to older events.
 */
export function readRecordedAgentStopAt(
  agent: { id: string; startedAt?: string; lastResumeAt?: string },
  opts: { beforeSequence?: number; reports?: { notBefore?: number } } = {},
): number | null {
  const rows = getOverdeckDatabase().prepare(`
    SELECT type, timestamp, json_extract(payload, '$.status') AS status
    FROM events
    WHERE type IN ('agent.started', 'agent.status_changed', 'agent.heartbeat_dead')
      AND json_extract(payload, '$.agentId') = ?
      AND (type <> 'agent.status_changed' OR json_extract(payload, '$.status') IN ('running', 'stopped'))
      AND sequence < ?
    ORDER BY sequence DESC
    LIMIT ?
  `).all(agent.id, opts.beforeSequence ?? Number.MAX_SAFE_INTEGER, LIFECYCLE_LOOKBACK_ROWS) as LifecycleRow[];
  const generation = [Date.parse(agent.startedAt ?? ''), Date.parse(agent.lastResumeAt ?? '')];
  const recordedAt = (row: LifecycleRow, notBefore?: number): number | null => {
    const at = eventMillis(row.timestamp);
    const bounds = [...generation, notBefore ?? Number.NaN].filter(Number.isFinite);
    return Number.isFinite(at) && bounds.every((bound) => at >= bound) ? at : null;
  };
  const isStop = (row: LifecycleRow | undefined) => row?.type === 'agent.status_changed' && row.status === 'stopped';
  let index = 0;
  while (index < rows.length) {
    const row = rows[index]!;
    const reportRows = row.type === 'agent.heartbeat_dead' ? 1
      : isStop(row) && rows[index + 1]?.type === 'agent.heartbeat_dead' ? 2 : 0;
    if (reportRows === 0) break;
    if (opts.reports) {
      const at = recordedAt(row, opts.reports.notBefore);
      if (at !== null) return at;
    }
    index += reportRows;
  }
  const latest = rows[index];
  return latest && isStop(latest) ? recordedAt(latest) : null;
}
