import { useEffect, useMemo } from 'react';

import { type DomainEvent, WS_METHODS } from '@overdeck/contracts';
import { Stream } from 'effect';

import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { useDashboardStore, selectIssues, selectAgents, selectBackendPanes, selectDerivedIssueState } from '../../lib/store';
import { useTasksQuery } from '../Stage/cockpit/TasksRail';
import type { Agent, BackendPane, DerivedIssueState, Issue } from '../../types';

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

export type DrawerTaskStatus = 'open' | 'current' | 'done';

export type DrawerTaskItem = {
  id: string;
  title: string;
  status: DrawerTaskStatus;
  duration: string;
};

export type DrawerVerificationGateStatus = 'pending' | 'running' | 'passed' | 'failed';

export type DrawerVerificationGate = {
  id: string;
  label: string;
  status: DrawerVerificationGateStatus;
  detail: string;
};

export type DrawerPhaseTimelineState = 'done' | 'current' | 'upcoming';

export type DrawerPhaseTimelineStep = {
  id: 'triaged' | 'planned' | 'implemented' | 'reviewed' | 'shipping' | 'merged';
  state: DrawerPhaseTimelineState;
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

type TaskTask = {
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  closedAt?: string;
};

type DrawerIssueSubscription = {
  issueId: string;
  refCount: number;
  unsubscribe: () => void;
  releaseTimer: number | null;
};

let drawerIssueSubscription: DrawerIssueSubscription | null = null;

function stopDrawerIssueSubscription() { if (drawerIssueSubscription?.releaseTimer) {
    window.clearTimeout(drawerIssueSubscription.releaseTimer);
  }
  drawerIssueSubscription?.unsubscribe();
  drawerIssueSubscription = null;
}

export function resetDrawerIssueSubscriptionForTest() {
  stopDrawerIssueSubscription();
}

export type DrawerData = {
  issue: Issue | null;
  agents: Agent[];
  derived?: DerivedIssueState;
  panes: BackendPane[];
  tasks: DrawerTaskItem[];
  reviewSpecialists: DrawerReviewSpecialist[];
  verificationGates: DrawerVerificationGate[];
  phaseTimeline: DrawerPhaseTimelineStep[];
  /** Capped (100 items) activity feed shown in the side rail. */
  activityRail: DrawerActivityItem[];
  /** Full activity feed for the Activity tab — same filter, no slice cap. */
  activityFull: DrawerActivityItem[];
};

function issueMatches(issue: Issue, issueId: string) {
  return issue.identifier.toLowerCase() === issueId.toLowerCase() || issue.id.toLowerCase() === issueId.toLowerCase();
}

function buildAgentIssueLookup(agents: Agent[]) {
  const lookup = new Map<string, string>();
  for (const agent of agents) {
    if (agent.issueId) lookup.set(agent.id.toLowerCase(), agent.issueId.toLowerCase());
  }
  return lookup;
}

function activityMatchesIssue(entry: ActivityEntry, issueId: string, agentIssueLookup: ReadonlyMap<string, string>) {
  const target = issueId.toLowerCase();
  if (entry.issueId) return entry.issueId.toLowerCase() === target;
  if (!entry.agentId) return false;
  return agentIssueLookup.get(entry.agentId.toLowerCase()) === target;
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

/** PAN-3917: the reviewer roster is the backend's review panes, not a record. */
function specialistStatus(pane: BackendPane): DrawerReviewSpecialistStatus {
  switch (pane.state) {
    case 'working': return 'run';
    case 'blocked': return 'fail';
    case 'done': return 'done';
    case 'exited': return 'done';
    default: return 'idle';
  }
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

function reviewSpecialists(panes: readonly BackendPane[]): DrawerReviewSpecialist[] {
  return panes
    .filter((pane) => pane.role === 'review')
    .map((pane) => {
      const status = specialistStatus(pane);
      return {
        id: pane.id,
        name: pane.model || pane.harness,
        status,
        meta: specialistMeta(status),
        duration: pane.harness,
      };
    });
}

function taskStatus(status: string | undefined): DrawerTaskStatus {
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

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function taskTitle(task: TaskTask, issueId: string) {
  const title = task.title ?? task.name ?? task.id ?? 'Untitled task';
  return title.replace(new RegExp(`^${escapeRegExp(issueId)}:\\s*`, 'i'), '');
}

function normalizeTasks(tasks: TaskTask[] | undefined, issueId: string): DrawerTaskItem[] {
  return (tasks ?? []).map((task) => {
    const status = taskStatus(task.status);
    return {
      id: task.id ?? task.title ?? 'task',
      title: taskTitle(task, issueId),
      status,
      duration: formatDuration(task.startedAt ?? task.createdAt, task.closedAt ?? task.updatedAt),
    };
  });
}

function gateDetail(status: DrawerVerificationGateStatus) {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'running':
      return 'running';
    case 'pending':
    default:
      return 'pending';
  }
}

/** PAN-3917 (FR-8): the PR's check runs are the verification gate. */
function verificationGates(derived: DerivedIssueState | undefined): DrawerVerificationGate[] {
  const checks = derived?.pr?.checks;
  const status: DrawerVerificationGateStatus =
    checks === 'green' ? 'passed' : checks === 'red' ? 'failed' : checks === 'pending' ? 'running' : 'pending';
  return [{ id: 'checks', label: 'checks', status, detail: gateDetail(status) }];
}

function formatWhen(value: string | undefined) {
  const time = parseTime(value);
  if (time === null) return '—';
  const date = new Date(time);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function phaseTimeline(issue: Issue | null, derived: DerivedIssueState | undefined): DrawerPhaseTimelineStep[] {
  const state = derived?.state;
  const merged = state === 'merged' || state === 'closed' || issue?.state === 'done' || issue?.status?.toLowerCase() === 'done' || Boolean(issue?.completedAt);
  const shippingCurrent = !merged && state === 'ready';
  const reviewedDone = merged || shippingCurrent;
  const reviewedCurrent = !reviewedDone && (state === 'in-review' || state === 'changes-requested');
  const implementedDone = reviewedDone || reviewedCurrent;
  const implementedCurrent = !implementedDone && (state === 'working' || issue?.state === 'in_progress' || issue?.status?.toLowerCase() === 'in progress');
  const plannedDone = implementedDone || implementedCurrent || state === 'planned' || Boolean(issue?.planningComplete);
  const plannedCurrent = !plannedDone && Boolean(issue?.hasPlan);
  const currentIndex = merged ? -1 : shippingCurrent ? 4 : reviewedCurrent ? 3 : implementedCurrent ? 2 : plannedCurrent ? 1 : 0;
  const done = [Boolean(issue), plannedDone, implementedDone, reviewedDone, merged, merged];

  // PAN-2908 C-VOCAB: ids carry the legacy when-stamps only — the six-phase
  // rail maps them (LEGACY_WHEN_TO_PHASE); the legacy labels are gone.
  const steps = [
    { id: 'triaged' as const, when: formatWhen(issue?.createdAt) },
    { id: 'planned' as const, when: formatWhen(issue?.updatedAt) },
    { id: 'implemented' as const, when: formatWhen(issue?.updatedAt) },
    { id: 'reviewed' as const, when: formatWhen(issue?.updatedAt) },
    { id: 'shipping' as const, when: formatWhen(issue?.updatedAt) },
    { id: 'merged' as const, when: formatWhen(issue?.completedAt) },
  ];
  return steps.map((step, index) => ({
    ...step,
    state: done[index] ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  })) as DrawerPhaseTimelineStep[];
}

/**
 * useIssueData — the pure, parameterized core of useDrawerData. Computes the
 * same issue projection (phaseTimeline, verificationGates, reviewSpecialists,
 * tasks, activity) for ANY issueId, WITHOUT touching the global `drawer` slice
 * — so the Command Deck issue cockpit (S2) can reuse PhaseTimeline /
 * VerificationGates / etc. without popping the legacy IssueDrawer overlay or
 * rewriting the URL. `useDrawerData()` is now a thin wrapper that passes the
 * drawer's selected issue. PAN-1520 / Command Deck remodel S2.
 */
export function useIssueData(issueIdArg: string | null): DrawerData {
  const drawerIssueId = issueIdArg;
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgents) as Agent[];
  const recentActivity = useDashboardStore((state) => state.recentActivity) as ActivityEntry[];
  const detailedActivity = useDashboardStore((state) => state.detailedActivity) as ActivityEntry[];
  const derived = useDashboardStore(selectDerivedIssueState(drawerIssueId ?? ''));
  const panes = useDashboardStore(selectBackendPanes(drawerIssueId ?? ''));
  // Live-fetched, not derived from the Issue store snapshot — the server
  // never populates an `issue.tasks` field, so the tab-band badge shares the
  // same `/api/issues/:id/tasks` query TasksRail/TasksPanel already use for
  // the task list itself (per TasksRail's useTasksQuery doc comment).
  const tasksQuery = useTasksQuery(drawerIssueId ?? '');

  useEffect(() => {
    if (!drawerIssueId) return;

    if (drawerIssueSubscription?.issueId === drawerIssueId) {
      if (drawerIssueSubscription.releaseTimer !== null) {
        window.clearTimeout(drawerIssueSubscription.releaseTimer);
        drawerIssueSubscription.releaseTimer = null;
      }
      drawerIssueSubscription.refCount += 1;
    } else {
      if (drawerIssueSubscription) {
        stopDrawerIssueSubscription();
      }

      const unsubscribe = getTransport().subscribe(
        (client) => (client as PanRpcProtocolClient)[WS_METHODS.subscribeIssueEvents]({ issueId: drawerIssueId }) as unknown as Stream.Stream<DomainEvent, Error, never>,
        (event) => useDashboardStore.getState().applyEvent(event as DomainEvent),
      );

      drawerIssueSubscription = {
        issueId: drawerIssueId,
        refCount: 1,
        unsubscribe,
        releaseTimer: null,
      };
    }

    return () => {
      if (drawerIssueSubscription?.issueId === drawerIssueId) {
        drawerIssueSubscription.refCount -= 1;
        if (drawerIssueSubscription.refCount === 0) {
          drawerIssueSubscription.releaseTimer = window.setTimeout(stopDrawerIssueSubscription, 1000);
        }
      }
    };
  }, [drawerIssueId]);

  return useMemo(() => {
    if (!drawerIssueId) {
      return { issue: null, agents: [], derived: undefined, panes: [], tasks: [], reviewSpecialists: [], verificationGates: [], phaseTimeline: [], activityRail: [], activityFull: [] };
    }

    const issue = issues.find((candidate) => issueMatches(candidate, drawerIssueId)) ?? null;
    const issueAgents = agents.filter((agent) => agent.issueId?.toLowerCase() === drawerIssueId.toLowerCase());
    const agentIssueLookup = buildAgentIssueLookup(agents);
    const byId = new Map<string, ActivityEntry>();
    for (const entry of [...recentActivity, ...detailedActivity]) {
      if (activityMatchesIssue(entry, drawerIssueId, agentIssueLookup)) byId.set(activityId(entry, byId.size), entry);
    }

    const activityFull = Array.from(byId.entries())
      .map(([id, entry]) => {
        const when = entry.timestamp ?? '';
        const time = when ? new Date(when).getTime() : 0;
        return {
          id,
          phase: phaseForActivity(entry),
          message: entry.message ?? 'Activity update',
          when,
          time: Number.isNaN(time) ? 0 : time,
        };
      })
      .sort((a, b) => b.time - a.time);

    const activityRail = activityFull.slice(0, 100);

    return {
      issue,
      agents: issueAgents,
      derived,
      panes,
      tasks: normalizeTasks(tasksQuery.data?.tasks, drawerIssueId),
      reviewSpecialists: reviewSpecialists(panes),
      verificationGates: verificationGates(derived),
      phaseTimeline: phaseTimeline(issue, derived),
      activityRail,
      activityFull,
    };
  }, [agents, detailedActivity, drawerIssueId, issues, recentActivity, derived, panes, tasksQuery.data]);
}

/**
 * useDrawerData — the legacy IssueDrawer's data hook. Thin wrapper over
 * useIssueData that sources the issue id from the global `drawer` slice.
 */
export function useDrawerData(): DrawerData {
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  return useIssueData(drawerIssueId);
}
