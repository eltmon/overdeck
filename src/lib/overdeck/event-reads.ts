/** Canonical narrow read door for retained agent runtime events. */
import { getOverdeckDatabaseSync } from './infra.js';

interface EventPayloadRow {
  payload: string | Record<string, unknown> | null;
}

interface AgentRuntimeEventRow extends EventPayloadRow {
  type: 'agent.created' | 'agent.model_set';
  timestamp: string | number;
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
export function readLatestAgentClaudeSessionIdEventSync(agentId: string): string | null {
  const row = getOverdeckDatabaseSync().prepare(`
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

function eventTimestamp(value: string | number): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : 0).toISOString();
}

/** Read retained identity and session evidence for agent-plane backfill. */
export function listAgentRuntimeEventEvidenceSync(): AgentRuntimeEventEvidence[] {
  const rows = getOverdeckDatabaseSync().prepare(`
    SELECT type, timestamp, payload
    FROM events
    WHERE type IN ('agent.created', 'agent.model_set')
    ORDER BY sequence ASC
  `).all() as AgentRuntimeEventRow[];
  const evidence = new Map<string, AgentRuntimeEventEvidence>();

  for (const row of rows) {
    const payload = parsePayload(row.payload);
    const agentId = typeof payload?.['agentId'] === 'string'
      ? payload['agentId'].trim()
      : '';
    if (!payload || !agentId) continue;
    const current = evidence.get(agentId) ?? {
      agentId,
      issueId: null,
      role: null,
      workspace: null,
      model: null,
      branch: null,
      startedAt: null,
      sessions: [],
    };

    if (row.type === 'agent.created') {
      const agent = payload['agent'] && typeof payload['agent'] === 'object'
        ? payload['agent'] as Record<string, unknown>
        : {};
      const issueId = payload['issueId'] ?? agent['issueId'];
      if (typeof issueId === 'string' && issueId.trim()) current.issueId = issueId.trim();
      if (typeof agent['role'] === 'string' && agent['role'].trim()) current.role = agent['role'].trim();
      if (typeof agent['workspace'] === 'string' && agent['workspace'].trim()) current.workspace = agent['workspace'].trim();
      if (typeof agent['model'] === 'string' && agent['model'].trim()) current.model = agent['model'].trim();
      if (typeof agent['branch'] === 'string' && agent['branch'].trim()) current.branch = agent['branch'].trim();
      if (typeof agent['startedAt'] === 'string' && agent['startedAt'].trim()) current.startedAt = agent['startedAt'].trim();
      const createdSessionId = agent['sessionId'];
      if (typeof createdSessionId === 'string' && createdSessionId.trim()) {
        current.sessions.push({
          id: createdSessionId.trim(),
          startedAt: current.startedAt ?? eventTimestamp(row.timestamp),
        });
      }
    } else if (Object.prototype.hasOwnProperty.call(payload, 'claudeSessionId')) {
      const sessionId = payload['claudeSessionId'];
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        current.sessions = [];
      } else if (!current.sessions.some((session) => session.id === sessionId.trim())) {
        current.sessions.push({
          id: sessionId.trim(),
          startedAt: eventTimestamp(row.timestamp),
        });
      }
    }
    evidence.set(agentId, current);
  }

  return [...evidence.values()];
}
