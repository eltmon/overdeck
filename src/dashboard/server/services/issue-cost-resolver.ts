import { AgentStatus, type AgentSnapshot } from '@panctl/contracts';

interface ResolveIssueHeadlineCostOptions {
  issueId: string;
  aggregateCost?: number;
  agents: ReadonlyArray<Pick<AgentSnapshot, 'issueId' | 'costSoFar' | 'status'>>;
}

export interface ResolvedIssueHeadlineCost {
  aggregateCost: number | null;
  liveCost: number | null;
  resolvedTotalCost: number | null;
}

const LIVE_AGENT_STATUSES = new Set<AgentStatus>(['starting', 'running']);

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function normalizePositiveCost(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function getLiveIssueCostForIssue(
  issueId: string,
  agents: ReadonlyArray<Pick<AgentSnapshot, 'issueId' | 'costSoFar' | 'status'>>,
): number | null {
  const normalizedIssueId = normalizeIssueId(issueId);
  let maxLiveCost: number | null = null;

  for (const agent of agents) {
    if (normalizeIssueId(agent.issueId) !== normalizedIssueId) continue;
    if (!LIVE_AGENT_STATUSES.has(agent.status)) continue;
    const candidate = normalizePositiveCost(agent.costSoFar);
    if (candidate === null) continue;
    if (maxLiveCost === null || candidate > maxLiveCost) {
      maxLiveCost = candidate;
    }
  }

  return maxLiveCost;
}

export function resolveIssueHeadlineCost({
  issueId,
  aggregateCost,
  agents,
}: ResolveIssueHeadlineCostOptions): ResolvedIssueHeadlineCost {
  const normalizedAggregateCost = normalizePositiveCost(aggregateCost);
  const liveCost = getLiveIssueCostForIssue(issueId, agents);

  return {
    aggregateCost: normalizedAggregateCost,
    liveCost,
    resolvedTotalCost:
      normalizedAggregateCost === null
        ? liveCost
        : liveCost === null
          ? normalizedAggregateCost
          : Math.max(normalizedAggregateCost, liveCost),
  };
}
