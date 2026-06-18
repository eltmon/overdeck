import type { AgentSnapshot } from '@overdeck/contracts';

export type DashboardAgentClassification = 'active' | 'stopped' | 'orphan_test';

export const ORPHAN_PREFIX_PATTERN = /^PAN-(AC|PI(-PROMPT)?|TEST|REVIEW|SHIP|SUB(REVIEW|SIGNAL)?)-?\d*$/;
export const ORPHAN_AGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

type ClassifiableAgent = Pick<AgentSnapshot, 'issueId' | 'status' | 'hasLiveTmuxSession' | 'lastActivity' | 'startedAt'>;

function getAgentTimestampMs(agent: ClassifiableAgent): number | null {
  const timestamp = agent.lastActivity ?? agent.startedAt;
  if (!timestamp) return null;

  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function classifyDashboardAgent(
  agent: ClassifiableAgent,
  nowMs = Date.now(),
): DashboardAgentClassification {
  if (agent.hasLiveTmuxSession === true) return 'active';

  if (
    agent.hasLiveTmuxSession === undefined &&
    (agent.status === 'running' || agent.status === 'starting')
  ) {
    return 'active';
  }

  const timestampMs = getAgentTimestampMs(agent);
  if (
    ORPHAN_PREFIX_PATTERN.test(agent.issueId) &&
    timestampMs !== null &&
    nowMs - timestampMs > ORPHAN_AGE_THRESHOLD_MS
  ) {
    return 'orphan_test';
  }

  return 'stopped';
}
