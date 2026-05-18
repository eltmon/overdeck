import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

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

export type DrawerBeadStatus = 'open' | 'current' | 'done';

export type DrawerBeadItem = {
  id: string;
  title: string;
  status: DrawerBeadStatus;
  duration: string;
};

export type DrawerVerificationGateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type DrawerVerificationGate = {
  id: 'typecheck' | 'lint' | 'test' | 'uat';
  label: string;
  status: DrawerVerificationGateStatus;
  detail: string;
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

type BeadTask = {
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  closedAt?: string;
};

type BeadsResponse = {
  tasks?: BeadTask[];
};

export type DrawerData = {
  issue: Issue | null;
  agents: Agent[];
  beads: DrawerBeadItem[];
  reviewSpecialists: DrawerReviewSpecialist[];
  verificationGates: DrawerVerificationGate[];
  activityRail: DrawerActivityItem[];
};

const REVIEW_SPECIALIST_ROLES = [
  'review.security',
  'review.correctness',
  'review.performance',
  'review.requirements',
] as const;

const QUALITY_GATE_ORDER = ['typecheck', 'lint', 'test'] as const;

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

function beadStatus(status: string | undefined): DrawerBeadStatus {
  if (status === 'closed') return 'done';
  if (status === 'in_progress') return 'current';
  return 'open';
}

function parseTime(value: string | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function formatDuration(startValue: string | undefined, endValue: string | undefined) {
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === null || end === null || end < start) return '—';

  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function beadTitle(bead: BeadTask, issueId: string) {
  const title = bead.title ?? bead.name ?? bead.id ?? 'Untitled bead';
  return title.replace(new RegExp(`^${issueId}:\\s*`, 'i'), '');
}

function normalizeBeads(tasks: BeadTask[] | undefined, issueId: string): DrawerBeadItem[] {
  return (tasks ?? []).map((bead) => {
    const status = beadStatus(bead.status);
    return {
      id: bead.id ?? bead.title ?? 'bead',
      title: beadTitle(bead, issueId),
      status,
      duration: formatDuration(bead.startedAt ?? bead.createdAt, bead.closedAt ?? bead.updatedAt),
    };
  });
}

function gateStatus(status: string | undefined): DrawerVerificationGateStatus {
  if (status === 'passed' || status === 'failed' || status === 'pending' || status === 'running' || status === 'skipped') return status;
  if (status === 'testing') return 'running';
  if (status === 'dispatch_failed') return 'failed';
  return 'pending';
}

function failedQualityGate(notes: string | undefined) {
  const match = notes?.match(/Verification FAILED at (typecheck|lint|test)\b/i);
  return match?.[1]?.toLowerCase() as (typeof QUALITY_GATE_ORDER)[number] | undefined;
}

function qualityGateStatus(gate: (typeof QUALITY_GATE_ORDER)[number], reviewStatus: ReviewStatusSnapshot | undefined): DrawerVerificationGateStatus {
  const verificationStatus = gateStatus(reviewStatus?.verificationStatus);
  if (verificationStatus === 'passed' || verificationStatus === 'skipped' || verificationStatus === 'running' || verificationStatus === 'pending') return verificationStatus;

  const failedGate = failedQualityGate(reviewStatus?.verificationNotes);
  if (!failedGate) return 'passed';
  if (gate === failedGate) return 'failed';
  return QUALITY_GATE_ORDER.indexOf(gate) < QUALITY_GATE_ORDER.indexOf(failedGate) ? 'passed' : 'pending';
}

function gateDetail(status: DrawerVerificationGateStatus) {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'running':
      return 'running';
    case 'skipped':
      return 'skipped';
    case 'pending':
    default:
      return 'pending';
  }
}

function verificationGates(reviewStatus: ReviewStatusSnapshot | undefined): DrawerVerificationGate[] {
  const qualityGates = QUALITY_GATE_ORDER.map((gate) => {
    const status = qualityGateStatus(gate, reviewStatus);
    return { id: gate, label: gate, status, detail: gateDetail(status) };
  });
  const uatStatus = gateStatus(reviewStatus?.uatStatus);
  return [...qualityGates, { id: 'uat', label: 'UAT', status: uatStatus, detail: gateDetail(uatStatus) }];
}

export function useDrawerData(): DrawerData {
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgentList) as Agent[];
  const recentActivity = useDashboardStore((state) => state.recentActivity) as ActivityEntry[];
  const detailedActivity = useDashboardStore((state) => state.detailedActivity) as ActivityEntry[];
  const reviewStatus = useDashboardStore(selectReviewStatus(drawerIssueId ?? ''));
  const { data: beadsData } = useQuery<BeadsResponse>({
    queryKey: ['drawer-beads', drawerIssueId],
    queryFn: async () => {
      const response = await fetch(`/api/issues/${drawerIssueId}/beads`);
      if (!response.ok) throw new Error('Failed to fetch drawer beads');
      return response.json();
    },
    enabled: drawerIssueId !== null,
    staleTime: 10_000,
  });

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
      beads: normalizeBeads(beadsData?.tasks, drawerIssueId),
      reviewSpecialists: reviewSpecialists(reviewStatus),
      verificationGates: verificationGates(reviewStatus),
      activityRail,
    };
  }, [agents, beadsData, detailedActivity, drawerIssueId, issues, recentActivity, reviewStatus]);
}
