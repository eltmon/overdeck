import { useMemo } from 'react';

import type { ReviewStatusSnapshot } from '@panctl/contracts';

import { useDashboardStore, selectIssues, selectAgentList, selectReviewStatus } from '../../lib/store';
import type { Agent, Issue } from '../../types';

export type DrawerActivityPhase = 'work' | 'review' | 'ship' | 'done' | 'info';

export type DrawerActivityItem = {
  id: string;
  phase: DrawerActivityPhase;
  message: string;
  when: string;
};

export type DrawerReviewSpecialistStatus = 'run' | 'idle' | 'done' | 'fail';

export type DrawerReviewSpecialist = {
  id: string;
  name: string;
  status: DrawerReviewSpecialistStatus;
  meta: string;
  duration: string;
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
  reviewSpecialists: DrawerReviewSpecialist[];
  verificationGates: unknown[];
  activityRail: DrawerActivityItem[];
};

const REVIEW_SPECIALIST_ROLES = [
  'review.security',
  'review.correctness',
  'review.performance',
  'review.requirements',
] as const;

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

function shortRoleName(role: string) {
  return role.replace('review.', '');
}

function specialistStatus(role: string, reviewStatus: ReviewStatusSnapshot | undefined): DrawerReviewSpecialistStatus {
  const subStatus = reviewStatus?.reviewSubStatuses?.[role];
  if (subStatus === 'done') return 'done';
  if (subStatus === 'running') return 'run';
  if (subStatus === 'failed') return 'fail';
  if (reviewStatus?.reviewStatus === 'failed' || reviewStatus?.reviewStatus === 'blocked') return 'fail';
  return 'idle';
}

function specialistMeta(status: DrawerReviewSpecialistStatus) {
  switch (status) {
    case 'run':
      return 'running';
    case 'done':
      return 'complete';
    case 'fail':
      return 'blocked';
    case 'idle':
    default:
      return 'waiting';
  }
}

function specialistDuration(role: string, reviewStatus: ReviewStatusSnapshot | undefined) {
  const sessionName = reviewStatus?.reviewSessionNames?.find((name) => name.includes(shortRoleName(role)));
  return sessionName ? sessionName.replace(/^agent-/, '') : '—';
}

function reviewSpecialists(reviewStatus: ReviewStatusSnapshot | undefined): DrawerReviewSpecialist[] {
  return REVIEW_SPECIALIST_ROLES.map((role) => {
    const status = specialistStatus(role, reviewStatus);
    return {
      id: role,
      name: role,
      status,
      meta: specialistMeta(status),
      duration: specialistDuration(role, reviewStatus),
    };
  });
}

export function useDrawerData(): DrawerData {
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgentList) as Agent[];
  const recentActivity = useDashboardStore((state) => state.recentActivity) as ActivityEntry[];
  const detailedActivity = useDashboardStore((state) => state.detailedActivity) as ActivityEntry[];
  const reviewStatus = useDashboardStore(selectReviewStatus(drawerIssueId ?? ''));

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
      reviewSpecialists: reviewSpecialists(reviewStatus),
      verificationGates: [],
      activityRail,
    };
  }, [agents, detailedActivity, drawerIssueId, issues, recentActivity, reviewStatus]);
}
