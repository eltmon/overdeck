/** Canonical narrow read door for retained agent runtime events. */
import { getOverdeckDatabaseSync } from './infra.js';

interface EventPayloadRow {
  payload: string | Record<string, unknown> | null;
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
