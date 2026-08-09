import { getAgentEffectiveLastActivityMs } from './agent-idle.js';

export const REVIEW_AGENT_IDLE_THRESHOLD_MS = 15 * 60 * 1000;
export const REVIEWING_WATCHDOG_THRESHOLD_MS = 45 * 60 * 1000;

type ReviewAgentRow = {
  id: string;
  issueId?: string | null;
  role?: string | null;
  status?: string | null;
  lastActivity?: string | null;
  reviewRunId?: string | null;
};

export type ReviewConvoyLiveness = {
  active: boolean;
  reason: string;
};

export function reviewTimestampMs(value: string | number | undefined): number {
  return value === undefined ? Number.NaN : new Date(value).getTime();
}

export function evaluateReviewConvoyLiveness(
  issueId: string,
  status: { reviewSpawnedAt?: string | number; updatedAt?: string },
  agents: readonly ReviewAgentRow[],
  now = Date.now(),
): ReviewConvoyLiveness {
  const issueUpper = issueId.toUpperCase();
  const reviewAgents = agents.filter((agent) => {
    const agentIssue = (agent.issueId ?? '').trim().toUpperCase();
    const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : null);
    return agentIssue === issueUpper && role === 'review';
  });

  const coordinatorId = `agent-${issueId.toLowerCase()}-review`;
  const coordinator = reviewAgents.find((agent) => agent.id === coordinatorId);
  if (coordinator?.status === 'stopped' || coordinator?.status === 'error') {
    return { active: false, reason: 'coordinator stopped' };
  }

  const reviewStartedAt = reviewTimestampMs(status.reviewSpawnedAt ?? status.updatedAt);
  if (Number.isFinite(reviewStartedAt) && now - reviewStartedAt >= REVIEWING_WATCHDOG_THRESHOLD_MS) {
    return { active: false, reason: 'review watchdog expired' };
  }

  const currentRunId = coordinator?.reviewRunId;
  const currentReviewAgents = currentRunId
    ? reviewAgents.filter((agent) => agent.reviewRunId === currentRunId)
    : reviewAgents;

  for (const agent of currentReviewAgents) {
    if (agent.status === 'stopped' || agent.status === 'error') continue;
    const persistedLastActivity = reviewTimestampMs(agent.lastActivity ?? undefined);
    if (!Number.isFinite(persistedLastActivity) || now - persistedLastActivity < REVIEW_AGENT_IDLE_THRESHOLD_MS) {
      return { active: true, reason: `active review agent ${agent.id}` };
    }
    const effectiveLastActivity = getAgentEffectiveLastActivityMs(agent.id);
    if (effectiveLastActivity !== null && now - effectiveLastActivity < REVIEW_AGENT_IDLE_THRESHOLD_MS) {
      return { active: true, reason: `active review agent ${agent.id}` };
    }
  }

  return { active: false, reason: reviewAgents.length === 0 ? 'no review agents' : 'all review agents stale' };
}
