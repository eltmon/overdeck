import { useMemo } from 'react';

import { useDashboardStore, selectIssues, selectAgentList } from '../../lib/store';
import type { Agent, Issue } from '../../types';

export type DrawerActivityPhase = 'work' | 'review' | 'ship' | 'done' | 'info';

export type DrawerActivityItem = {
  id: string;
  phase: DrawerActivityPhase;
  message: string;
  when: string;
};

type ActivityEntry = {
  id?: string;
  timestamp?: string;
  source?: string;
  level?: string;
  message?: string;
  issueId?: string | null;
  agentId?: string | null;
  category?: string | null;
  triggeringEvent?: string | null;
};

export type DrawerData = {
  issue: Issue | null;
  agents: Agent[];
  beads: unknown[];
  reviewSpecialists: Agent[];
  verificationGates: unknown[];
  activityRail: DrawerActivityItem[];
};

function issueMatches(issue: Issue, issueId: string) {
  return issue.identifier.toLowerCase() === issueId.toLowerCase() || issue.id.toLowerCase() === issueId.toLowerCase();
}

function activityMatchesIssue(entry: ActivityEntry, issueId: string) {
  if (entry.issueId) return entry.issueId.toLowerCase() === issueId.toLowerCase();
  if (!entry.agentId) return false;
  return entry.agentId.toLowerCase() === `agent-${issueId.toLowerCase()}`;
}

function phaseForActivity(entry: ActivityEntry): DrawerActivityPhase {
  const source = `${entry.source ?? ''} ${entry.category ?? ''} ${entry.triggeringEvent ?? ''}`.toLowerCase();
  if (entry.level === 'success' || source.includes('done') || source.includes('merge')) return 'done';
  if (source.includes('ship')) return 'ship';
  if (source.includes('review') || source.includes('test')) return 'review';
  if (source.includes('work') || source.includes('agent')) return 'work';
  return 'info';
}

function activityId(entry: ActivityEntry, index: number) {
  return entry.id ?? `${entry.timestamp ?? 'activity'}-${index}`;
}

export function useDrawerData(): DrawerData {
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgentList) as Agent[];
  const recentActivity = useDashboardStore((state) => state.recentActivity) as ActivityEntry[];
  const detailedActivity = useDashboardStore((state) => state.detailedActivity) as ActivityEntry[];

  return useMemo(() => {
    if (!drawerIssueId) {
      return { issue: null, agents: [], beads: [], reviewSpecialists: [], verificationGates: [], activityRail: [] };
    }

    const issue = issues.find((candidate) => issueMatches(candidate, drawerIssueId)) ?? null;
    const issueAgents = agents.filter((agent) => agent.issueId?.toLowerCase() === drawerIssueId.toLowerCase());
    const byId = new Map<string, ActivityEntry>();
    for (const entry of [...recentActivity, ...detailedActivity]) {
      if (activityMatchesIssue(entry, drawerIssueId)) byId.set(activityId(entry, byId.size), entry);
    }

    const activityRail = Array.from(byId.entries())
      .map(([id, entry]) => ({
        id,
        phase: phaseForActivity(entry),
        message: entry.message ?? 'Activity update',
        when: entry.timestamp ?? '',
      }))
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return {
      issue,
      agents: issueAgents,
      beads: [],
      reviewSpecialists: issueAgents.filter((agent) => agent.role === 'review' || agent.role === 'test'),
      verificationGates: [],
      activityRail,
    };
  }, [agents, detailedActivity, drawerIssueId, issues, recentActivity]);
}
