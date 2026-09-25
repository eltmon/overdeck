import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import {
  Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge,
  ChevronRight, ChevronDown, MessageSquare,
} from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers } from './ProjectNode';
import type { Harness } from '../../shared/ModelPicker';
import { ResourcesGroup } from './ResourcesGroup';
import { getUatStackSummary } from '../UatStackStatus';
import { FeatureAppLink, FeatureUatChip } from './FeatureAppLink';
import { UatStackTreeGroup } from './UatStackTreeGroup';
import { useWorkspaceQuery } from '../ZoneCOverviewTabs/queries';
import { createUatActionHandler } from './uat-action-handlers';
import { ContextMenuRoot, ContextMenuTrigger } from '../../shared/ContextMenu';
import {
  IssueActionContextMenu,
  IssueActionDialogHost,
  useIssueActions,
} from '../../IssueActionMenu';
import { IssuePeek } from '../../issue-detail/IssuePeek';
import { useConvoDock } from '../../../lib/convoDock';
import { useDerivedIssueState } from '../../../lib/store';
import { resolveFeatureStateBadge } from './featureStateBadge';
import { StatusDot } from '../StatusDot';
import { PIPE_ORDER, PIPE_CLASS, PIPE_STEP_LABELS, derivePipeline, describePipeline, describePipeSegment } from './pipelineStrip';
import { ResourceCluster } from './ResourceCluster';
import { PROJECT_TREE_CONTEXT_ACTIONS, type NonIssueActionContext } from '../../../lib/issueActions';
import { parseContainerServiceName } from '../../../lib/resource-utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MergeButton } from '../../MergeButton'; import { OrderBookIssueChip } from '../../orders/OrderBookIssueChip';
import { IssueView, IssueViewFullscreenButton, RailShipProgress } from '../../issue-view/IssueView';
import { StartAgentCta } from '../../issue-view/StartAgentCta';
import { ExpandableSessionNode } from './ExpandableSessionNode';
import { SessionNode } from './SessionNode';
import { useDashboardStore } from '../../../lib/store';
import { computeDominantStatus, sessionsNeedAttention } from './sessionAggregates';
import styles from '../styles/command-deck.module.css';
export type TreeSessionFilter = 'all' | 'alive' | 'failed';
interface FeatureItemProps {
  feature: ProjectFeature;
  isSelected: boolean;
  onSelect: () => void;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  title?: string;
  cost?: number;
  filter?: TreeSessionFilter;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onUnpauseSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onCleanupOrphanedResources?: (issueId: string) => void;
  onOpenPlanDialog?: (issueId: string) => void;
  containerStats?: Record<string, { id: string; name: string; cpuPercent: number; memoryUsage: number; status: 'running' | 'stopped' | 'unhealthy' | 'restarting' }>;
}

function StatusIcon({ status, agentStatus, stateLabel, isRally, isReady }: { status: string; agentStatus: string | null; stateLabel: string; isRally?: boolean; isReady?: boolean }) {
  // Merge-ready takes precedence — human action needed
  if (isReady) {
    return <GitMerge size={14} style={{ color: 'var(--primary)' }} />;
  }
  // Rally feature: layers icon with color based on state
  if (isRally) {
    const color = stateLabel === 'Done' ? 'var(--success)'
      : stateLabel === 'In Progress' ? 'var(--warning)'
      : 'var(--muted-foreground)';
    return <Layers size={14} style={{ color }} />;
  }
  // Green spinner: only when agent is truly actively running
  if (status === 'running') {
    return <Loader2 size={14} className={styles.spinning} style={{ color: 'var(--success)' }} />;
  }
  // Yellow triangle: agent exists but not actively working (suspended, idle with session, needs attention)
  if (agentStatus === 'suspended' || stateLabel === 'In Progress' || stateLabel === 'Suspended') {
    return <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />;
  }
  // Check: has planning context
  if (status === 'has_state') {
    return <CheckCircle2 size={14} style={{ color: 'var(--muted-foreground)' }} />;
  }
  // Default: empty circle
  return <Circle size={14} style={{ color: 'var(--muted-foreground)' }} />;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

type AggregateActivityState = 'running' | 'error' | 'queued' | 'stopped';

type AggregateBadge =
  | { key: 'input'; label: string; tone: 'waiting' }
  | { key: 'work'; label: string; tone: 'running' | 'stopped' }
  | { key: 'reviewers'; label: string; tone: 'running' | 'stopped' }
  | { key: 'review-error'; label: string; tone: 'error' };

/** Compact age label for the paused badge (PAN-1779): 99h / 3d. */

function formatRoleList(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  if (roles.length === 1) return roles[0]!;
  if (roles.length === 2) return `${roles[0]} and ${roles[1]}`;
  return `${roles.slice(0, -1).join(', ')}, and ${roles[roles.length - 1]}`;
}

export function isWorkOrSpecialistSession(session: SessionNodeType): boolean {
  return session.type === 'work'
    || session.type === 'knowledge'
    || session.type === 'strike'
    || session.type === 'planning'
    || session.type === 'review'
    || session.type === 'reviewer'
    || session.type === 'test'
    || session.type === 'ship'
    || session.type === 'merge';
}

function isErrorSession(session: SessionNodeType): boolean {
  const status = (session.status || '').toLowerCase();
  return status === 'error' || status.includes('fail') || status.includes('stuck');
}

function isQueuedSession(session: SessionNodeType): boolean {
  const status = (session.status || '').toLowerCase();
  return status === 'starting' || status === 'unknown' || status.includes('queued');
}

function isRunningSession(session: SessionNodeType): boolean {
  return session.status === 'running' && session.presence === 'active';
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function getAggregateActivityState(sessions: readonly SessionNodeType[]): AggregateActivityState {
  if (sessions.some(isErrorSession)) return 'error';
  if (sessions.some((session) => session.awaitingInput === true)) return 'queued';
  if (sessions.some(isRunningSession)) return 'running';
  if (sessions.some(isQueuedSession)) return 'queued';
  return 'stopped';
}


function buildActivitySummary(sessions: readonly SessionNodeType[]): string {
  if (sessions.length === 0) return 'No sessions';

  const runningWork = sessions.filter(session =>
    session.type === 'work' && isRunningSession(session),
  );
  const reviewErrors = sessions.filter(session =>
    (session.type === 'review' || session.type === 'reviewer') && isErrorSession(session),
  );
  const queued = sessions.filter(isQueuedSession);
  const stoppedReviewers = sessions.filter(session =>
    session.type === 'reviewer' && !isRunningSession(session) && !isErrorSession(session) && !isQueuedSession(session),
  );
  const genericRunning = sessions.filter(session =>
    session.type !== 'work' && isRunningSession(session),
  );

  const parts: string[] = [];

  if (runningWork.length > 0) {
    const longest = runningWork.reduce(
      (max, session) => Math.max(max, session.duration ?? 0),
      0,
    );
    parts.push(`${runningWork.length} work agent${runningWork.length === 1 ? '' : 's'} running ${formatSessionDuration(longest)}`);
  }

  if (genericRunning.length > 0) {
    parts.push(`${genericRunning.length} specialist${genericRunning.length === 1 ? '' : 's'} running`);
  }

  if (reviewErrors.length > 0) {
    parts.push(`${reviewErrors.length} review error${reviewErrors.length === 1 ? '' : 's'}`);
  }

  if (queued.length > 0) {
    parts.push(`${queued.length} queued or starting`);
  }

  if (stoppedReviewers.length > 0) {
    parts.push(`${stoppedReviewers.length} reviewer${stoppedReviewers.length === 1 ? '' : 's'} stopped`);
  }

  if (parts.length === 0) {
    return sessions.every(session => session.presence === 'ended')
      ? `All ${sessions.length} session${sessions.length === 1 ? '' : 's'} stopped`
      : `${sessions.length} session${sessions.length === 1 ? '' : 's'} idle`;
  }

  return parts.join(', ');
}

function getAggregateBadges(sessions: readonly SessionNodeType[]): AggregateBadge[] {
  const workSessions = sessions.filter(session => session.type === 'work');
  const reviewerSessions = sessions.filter(session => session.type === 'reviewer' || session.type === 'review');
  const reviewerErrors = reviewerSessions.filter(isErrorSession);
  const activeReviewers = reviewerSessions.filter(session => isRunningSession(session) || isQueuedSession(session));

  const badges: AggregateBadge[] = [];

  if (sessions.some((session) => session.awaitingInput === true)) {
    badges.push({
      key: 'input',
      label: '! INPUT',
      tone: 'waiting',
    });
  }

  if (workSessions.length > 0) {
    badges.push({
      key: 'work',
      label: '▸ work',
      tone: workSessions.some(isRunningSession) ? 'running' : 'stopped',
    });
  }

  if (reviewerSessions.length > 0) {
    badges.push({
      key: 'reviewers',
      label: `●●● ${reviewerSessions.length}`,
      tone: activeReviewers.length > 0 ? 'running' : 'stopped',
    });
  }

  if (reviewerErrors.length > 0) {
    badges.push({
      key: 'review-error',
      label: '✕ review',
      tone: 'error',
    });
  }

  return badges;
}

function getAggregateBadgeTitle(badge: AggregateBadge, sessions: readonly SessionNodeType[]): string {
  if (badge.key === 'input') {
    const waiting = sessions.find((session) => session.awaitingInput === true);
    const firstLine = waiting?.awaitingInputPrompt
      ?.split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim();
    return firstLine
      ? `Awaiting user input in ${waiting?.sessionId}: ${firstLine}`
      : `Awaiting user input in ${waiting?.sessionId ?? 'an agent session'}.`;
  }

  if (badge.key === 'work') {
    const workSessions = sessions.filter((session) => session.type === 'work');
    const runningWork = workSessions.filter(isRunningSession);
    const queuedWork = workSessions.filter(isQueuedSession);
    const stoppedWork = workSessions.filter((session) => !isRunningSession(session) && !isQueuedSession(session));
    const longest = runningWork.reduce((max, session) => Math.max(max, session.duration ?? 0), 0);
    const parts = [
      `Work agent sessions for this issue: ${workSessions.length} total.`,
    ];
    if (runningWork.length > 0) {
      parts.push(`${runningWork.length} running${longest > 0 ? ` (${formatSessionDuration(longest)} longest)` : ''}.`);
    }
    if (queuedWork.length > 0) parts.push(`${queuedWork.length} queued or starting.`);
    if (stoppedWork.length > 0) parts.push(`${stoppedWork.length} stopped or idle.`);
    return parts.join(' ');
  }

  if (badge.key === 'reviewers') {
    const reviewerSessions = sessions.filter((session) => session.type === 'review' || session.type === 'reviewer');
    const running = reviewerSessions.filter(isRunningSession);
    const queued = reviewerSessions.filter(isQueuedSession);
    const stopped = reviewerSessions.filter((session) => !isRunningSession(session) && !isQueuedSession(session) && !isErrorSession(session));
    const roles = Array.from(new Set(
      reviewerSessions
        .map((session) => session.role?.trim())
        .filter((role): role is string => Boolean(role)),
    ));
    const parts = [
      `Review pipeline sessions for this issue: ${reviewerSessions.length} total.`,
      `${running.length} active, ${queued.length} queued or starting, ${stopped.length} stopped.`,
    ];
    if (roles.length > 0) {
      parts.push(`Roles present: ${formatRoleList(roles)}.`);
    }
    return parts.join(' ');
  }

  const failures = sessions.filter((session) => (session.type === 'review' || session.type === 'reviewer') && isErrorSession(session));
  const failingRoles = Array.from(new Set(
    failures
      .map((session) => session.role?.trim())
      .filter((role): role is string => Boolean(role)),
  ));
  const parts = [`Review pipeline has ${failures.length} failing session${failures.length === 1 ? '' : 's'}.`];
  if (failingRoles.length > 0) {
    parts.push(`Affected roles: ${formatRoleList(failingRoles)}.`);
  }
  return parts.join(' ');
}

const TYPE_PRIORITY: Record<string, number> = {
  work: 0,
  strike: 1,
  lint: 2,
  review: 3,
  test: 4,
  reviewer: 5,
  planning: 6,
  ship: 7,
  merge: 8,
  legacy: 9,
};

const PRESENCE_PRIORITY: Record<string, number> = {
  active: 0,
  idle: 1,
  suspended: 2,
  ended: 3,
};

/** Pick the best session to auto-select: active > idle > suspended > ended; among active prefer work > review > test. */
export function pickBestSession(sessions: readonly SessionNodeType[]): string | null {
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => {
    const presenceDiff = PRESENCE_PRIORITY[a.presence] - PRESENCE_PRIORITY[b.presence];
    if (presenceDiff !== 0) return presenceDiff;
    const typeDiff = (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99);
    if (typeDiff !== 0) return typeDiff;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
  return sorted[0]!.sessionId;
}

function getExpandedKey(issueId: string): string {
  return `mc-feature-expanded:${issueId}`;
}

/** Read persisted expand state. Returns null when the user has never toggled
 *  this feature, so the caller can apply a status-driven default. */
function readExpanded(issueId: string): boolean | null {
  try {
    const raw = localStorage.getItem(getExpandedKey(issueId));
    if (raw === null) return null;
    return raw === 'true';
  } catch {
    return null;
  }
}

function writeExpanded(issueId: string, expanded: boolean): void {
  try {
    if (expanded) {
      localStorage.setItem(getExpandedKey(issueId), 'true');
    } else {
      localStorage.removeItem(getExpandedKey(issueId));
    }
  } catch { /* ignore */ }
}

/** In-flight issues (In Progress, In Review, Testing) default expanded so
 *  active work is visible at a glance. Done/closed issues default collapsed
 *  to keep the tree scannable. Users can override; that choice is persisted. */
function defaultExpandedFromState(stateLabel: string): boolean {
  const s = stateLabel.toLowerCase();
  return s.includes('progress') || s.includes('review') || s.includes('testing') || s.includes('verifying');
}

/** Whether a session passes the tree filter. */
export function sessionMatchesFilter(session: SessionNodeType, filter: TreeSessionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'alive') return session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
  if (filter === 'failed') {
    const st = (session.status || '').toLowerCase();
    return st.includes('fail') || st.includes('error') || st.includes('stuck');
  }
  return true;
}

interface FeatureContextMenuProps {
  feature: ProjectFeature;
  workSessionId: string | null;
  hasJsonl: boolean;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onOpenPlanDialog?: (issueId: string) => void;
}

function FeatureContextMenu({
  feature,
  workSessionId,
  hasJsonl,
  onOpenStateDir,
  onViewJsonl,
}: FeatureContextMenuProps) {
  const issueActions = useIssueActions(feature.issueId);
  const actionContext = {
    sessionId: workSessionId ?? undefined,
    hasJsonl,
    onOpenStateDir,
    onViewJsonl,
  } satisfies NonIssueActionContext;
  const nonIssueActions = PROJECT_TREE_CONTEXT_ACTIONS
    .filter((action) => action.ownerSurface === 'FeatureItem' && action.scope === 'session-artifact')
    .filter((action) => action.enabledWhen(actionContext))
    .map((action) => ({ action, context: actionContext }));

  return (
    <>
      <IssueActionContextMenu actions={issueActions} nonIssueActions={nonIssueActions} data-section="FeatureContextMenu (issue-row right-click)" />
      <IssueActionDialogHost issueId={feature.issueId} actions={issueActions} />
    </>
  );
}

function ReviewGroup({
  parent,
  children,
  issueId,
  selectedSessionId,
  onSelectSession,
  onStopSession,
  onViewTerminal,
  onPauseSession,
  onResumeSession,
  onUnpauseSession,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
}: {
  parent: SessionNodeType;
  children: SessionNodeType[];
  issueId: string;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onUnpauseSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
}) {
  // Collapsed by default (PAN-1779): the convoy reads as one summary line —
  // expand only when you need per-reviewer detail.
  const [expanded, setExpanded] = useState(false);

  const errorCount = children.filter((s) => s.status === 'error').length;
  const liveCount = children.filter((s) => s.status === 'running' || s.status === 'starting').length;
  const summary = children.length === 0
    ? undefined
    : `${children.length} reviewer${children.length === 1 ? '' : 's'}${
        errorCount > 0 ? ` · ${errorCount} error` : liveCount > 0 ? ` · ${liveCount} running` : ' · clean'
      }`;

  return (
    <div data-section="ReviewGroup">
      <SessionNode
        session={parent}
        subtitle={summary}
        issueId={issueId}
        isSelected={selectedSessionId === parent.sessionId}
        onClick={() => onSelectSession?.(issueId, parent.sessionId)}
        onStopSession={onStopSession}
        onViewTerminal={onViewTerminal}
        onPauseSession={onPauseSession}
        onResumeSession={onResumeSession}
        onUnpauseSession={onUnpauseSession}
        onRestartSession={onRestartSession}
        onDeepWipe={onDeepWipe}
        onOpenStateDir={onOpenStateDir}
        onViewJsonl={onViewJsonl}
        expandable
        expanded={expanded}
        onToggleExpand={() => setExpanded(e => !e)}
      />
      {expanded && children.length > 0 && (
        <div className={styles.sessionChildList}>
          {children.map(session => (
            <SessionNode
              key={session.sessionId}
              session={session}
              issueId={issueId}
              isSelected={selectedSessionId === session.sessionId}
              onClick={() => onSelectSession?.(issueId, session.sessionId)}
              onStopSession={onStopSession}
              onViewTerminal={onViewTerminal}
              onPauseSession={onPauseSession}
              onResumeSession={onResumeSession}
              onUnpauseSession={onUnpauseSession}
              onRestartSession={onRestartSession}
              onDeepWipe={onDeepWipe}
              onOpenStateDir={onOpenStateDir}
              onViewJsonl={onViewJsonl}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface UatTrainBadgeInfo { name: string; status: string; order: number; total: number }

/** Merge-train membership for the train chip (PAN-1779). One shared query —
 *  react-query dedupes across all FeatureItem instances. */
function useUatTrainMembership(): Map<string, UatTrainBadgeInfo> {
  const { data } = useQuery({
    queryKey: ['uat-generations'],
    queryFn: async () => {
      const res = await fetch('/api/merge-train/generations'); // PAN-1696: one entry per project; members are project-scoped and the badge keys by issue id, so flattening every chain is correct
      if (!res.ok) return [];
      return ((await res.json()) as Array<{ generations?: Array<{ name: string; status: string; members?: Array<{ issueId: string; mergeOrder: number }> }> }>).flatMap((entry) => entry.generations ?? []);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return useMemo(() => {
    const map = new Map<string, UatTrainBadgeInfo>();
    const generations = Array.isArray(data) ? data : [];
    for (const gen of generations) {
      const members = gen.members ?? [];
      for (const member of members) {
        const key = member.issueId.toUpperCase();
        if (!map.has(key)) map.set(key, { name: gen.name, status: gen.status, order: member.mergeOrder, total: members.length });
      }
    }
    return map;
  }, [data]);
}

export function FeatureItem({ feature, isSelected, onSelect, selectedSessionId, onSelectSession, title, cost, filter = 'all', onStopSession, onViewTerminal, onPauseSession, onResumeSession, onUnpauseSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl, onCleanupOrphanedResources, onOpenPlanDialog, containerStats }: FeatureItemProps) {
  const queryClient = useQueryClient();
  const openIssue = useDashboardStore((state) => state.openIssue);
  const addToDock = useConvoDock((s) => s.add);
  const trimmedTitle = title?.trim() ?? '';
  const displayTitle = trimmedTitle || '(untitled)';
  const titleClassName = trimmedTitle
    ? styles.featureLabel
    : `${styles.featureLabel} ${styles.featureLabelUntitled}`;

  const [expanded, setExpanded] = useState(() => {
    const persisted = readExpanded(feature.issueId);
    return persisted ?? defaultExpandedFromState(feature.stateLabel);
  });
  const [detailIdentifiers, setDetailIdentifiers] = useState<ProjectFeatureResourceIdentifiers | null>(null);

  useEffect(() => {
    if (!expanded) return;
    if (!feature.issueId) return;
    if (detailIdentifiers) return;

    let cancelled = false;
    void fetch(`/api/issues/${encodeURIComponent(feature.issueId)}/resource-details`)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<ProjectFeatureResourceIdentifiers>;
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        setDetailIdentifiers(payload);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, feature.issueId, detailIdentifiers]);

  const hasResources = feature.resourceDetails && (
    feature.resourceDetails.dockerContainerCount > 0 ||
    feature.resourceDetails.prs.length > 0 ||
    feature.resourceDetails.localBranchCount > 0 ||
    feature.resourceDetails.remoteBranchCount > 0 ||
    Boolean(feature.resourceDetails.remoteAgent)
  );

  const visibleSessions = useMemo(
    () => feature.sessions?.filter((session) => sessionMatchesFilter(session, filter)) ?? [],
    [feature.sessions, filter],
  );
  const hasVisibleSessions = visibleSessions.length > 0;
  const bestSessionId = useMemo(
    () => (visibleSessions.length > 0 ? pickBestSession(visibleSessions) : null),
    [visibleSessions],
  );

  const hasJsonl = useMemo(
    () => visibleSessions.some((session) => session.hasJsonl),
    [visibleSessions],
  );

  const issueConversations = feature.resourceDetails?.conversations ?? [];
  const hasConversations = issueConversations.length > 0;
  const hasExpandableChildren = hasVisibleSessions || hasConversations;

  const workSession = feature.sessions?.find((s) => s.type === 'work');
  const workSessionId = workSession?.sessionId ?? bestSessionId ?? null;

  // PAN-3917: "ready to merge" is derived from the forge (approved, green,
  // mergeable), never a stored isReadyToMerge flag.
  const storeDerived = useDerivedIssueState(feature.issueId);
  const resolvedState = storeDerived?.state ?? feature.state ?? null;
  const isReady = resolvedState === 'ready';

  const aggregateSessions = feature.sessions?.filter(isWorkOrSpecialistSession) ?? [];
  const activityState = getAggregateActivityState(aggregateSessions);
  const activitySummary = buildActivitySummary(aggregateSessions);
  const aggregateBadges = getAggregateBadges(aggregateSessions);
  const stateBadge = resolveFeatureStateBadge({
    storeState: storeDerived?.state,
    restState: feature.state,
    sessions: feature.sessions,
    pipelineBucket: feature.pipelineBucket,
    rawTrackerState: feature.rawTrackerState,
  });

  // Dominant session state for the feature row StatusDot (blocker-7)
  const dominantStatus = feature.sessions && feature.sessions.length > 0
    ? computeDominantStatus(feature.sessions)
    : null;

  // PAN-4201: the state badge is the row's one colored status signal; the
  // wrapper edge bar keeps only the error variant (red = broken).
  const hasErrorSession = aggregateSessions.some(isErrorSession);
  const edgeClass = hasErrorSession ? styles.featureItemWrapperError : '';

  const pipeline = useMemo(
    () => derivePipeline(feature, feature.sessions ?? [], isReady),
    [feature, isReady],
  );
  const pipelineLabel = useMemo(() => describePipeline(pipeline), [pipeline]);
  const trainInfo = useUatTrainMembership().get(feature.issueId.toUpperCase());
  const shouldShowUatStack = expanded && isReady && Boolean(feature.resourceDetails?.hasWorkspace);
  // Any expanded row with a workspace queries (not just merge-ready), so
  // FeatureAppLink can render during work phase; collapsed rows never poll.
  const workspaceQuery = useWorkspaceQuery(feature.issueId, {
    enabled: expanded && Boolean(feature.resourceDetails?.hasWorkspace),
  });
  const workspace = workspaceQuery.data;
  const stackPending = workspace?.pendingOperation?.status === 'running' && (
    workspace.pendingOperation.type === 'containerize' ||
    workspace.pendingOperation.type === 'start' ||
    workspace.pendingOperation.type === 'rebuild-stack' ||
    workspace.pendingOperation.type === 'start-stack' ||
    workspace.pendingOperation.type === 'stop-stack' ||
    workspace.pendingOperation.type === 'restart-stack' ||
    workspace.pendingOperation.type === 'reap-workspace'
  );
  const uatStackSummary = getUatStackSummary({
    containers: workspace?.containers,
    stackHealth: workspace?.stackHealth,
    pending: stackPending,
  });
  const flashKey = `${feature.issueId}:${dominantStatus ?? 'none'}:${visibleSessions.length}:${activityState}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const handleToggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    setExpanded(next);
    writeExpanded(feature.issueId, next);
  }, [expanded, feature.issueId]);

  const handleRowClick = useCallback(() => {
    onSelect();
    if (!expanded) {
      setExpanded(true);
      writeExpanded(feature.issueId, true);
    }
  }, [onSelect, expanded, feature.issueId]);

  const progressPct = feature.isRally && feature.childCount && feature.childCount > 0
    ? Math.round((feature.completedCount || 0) / feature.childCount * 100)
    : null;

  return (
    <ContextMenuRoot>
      <IssueView
        issueId={feature.issueId}
        density={expanded ? 'cockpit' : 'rail'}
        className={`${styles.featureItemWrapper} ${edgeClass} ${sessionsNeedAttention(aggregateSessions) ? styles.featureItemWrapperNeedsAttention : ''} ${isSelected ? styles.featureItemWrapperSelected : ''} ${flashClass}`}
        data-needs-attention={sessionsNeedAttention(aggregateSessions) ? 'true' : undefined}
        data-component="feature-item"
        data-issue-id={feature.issueId}
      >
        <div data-section="Filter bar">
        {/* PAN-2908 C-CONVO: deck rows carry the hover peek too — same glance
            depth as pipeline rows and board cards. */}
        <IssuePeek issueId={feature.issueId} onDock={addToDock}>
        <div data-section="Feature (issue) row" className={styles.featureItemRow}>
          {hasExpandableChildren ? (
            <button
              className={styles.featureItemCaret}
              onClick={handleToggleExpanded}
              aria-label={expanded ? 'Collapse sessions' : 'Expand sessions'}
              title={expanded ? 'Collapse sessions' : 'Expand sessions'}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className={styles.featureItemCaretPlaceholder} />
          )}
          {expanded && <IssueViewFullscreenButton className={styles.featureItemCaret} onClick={() => openIssue(feature.issueId)} />}
          <OrderBookIssueChip issueId={feature.issueId} />
          <ContextMenuTrigger asChild>
            <button
              className={`${styles.featureItem} ${isSelected ? styles.featureItemSelected : ''}`}
              onClick={handleRowClick}
            >
          <span className={styles.featureTitleLine}>
            {feature.isShadow ? (
              <span className={styles.featureStatus}><Eye size={14} style={{ color: 'var(--primary)' }} /></span>
            ) : feature.isRally ? (
              <span className={styles.featureStatus}>
                <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} isRally={feature.isRally} isReady={isReady} />
              </span>
            ) : null}
            <span className={styles.featureId_sidebar} title={activitySummary}>{feature.issueId}</span>
            <span className={titleClassName} title={displayTitle}>
              {displayTitle}
            </span>
            {cost !== undefined && cost > 0 && (
              <span className={styles.featureCost}>{formatCost(cost)}</span>
            )}
          </span>
          <span className={styles.featureMetaLine}>
          {/* PAN-2975: the resume affordance lives INSIDE the row's meta line
              as a badge-like chip — never a detached block above the card. */}
          <StartAgentCta issueId={feature.issueId} density="rail" surface="chip" />
          {dominantStatus && ['active', 'thinking', 'waiting'].includes(dominantStatus) && (
            <StatusDot status={dominantStatus} title={activitySummary} />
          )}
          {!feature.isRally && aggregateBadges.length > 0 && (
            <span data-section="Badges" className={styles.featureBadgeGroup}>
              {aggregateBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`${styles.featureBadge} ${styles[`featureBadge_${badge.tone === 'running' ? 'stopped' : badge.tone}` as keyof typeof styles]}`}
                  title={getAggregateBadgeTitle(badge, aggregateSessions)}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          )}
          {feature.isRally && feature.childCount != null && feature.childCount > 0 ? (
            <span className={`${styles.featureStateBadge} ${styles.featureStateBadge_rest}`} title={`${feature.completedCount || 0}/${feature.childCount} stories done${feature.inProgressCount ? `, ${feature.inProgressCount} active` : ''}${progressPct !== null ? ` (${progressPct}% complete)` : ''}`}>
              {feature.completedCount || 0}/{feature.childCount}
              {progressPct !== null && (
                <span style={{
                  display: 'inline-block',
                  width: 24,
                  height: 4,
                  marginLeft: 4,
                  background: 'var(--border)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  verticalAlign: 'middle',
                }}>
                  <span style={{
                    display: 'block',
                    width: `${progressPct}%`,
                    height: '100%',
                    background: progressPct === 100 ? 'var(--success)' : 'var(--warning)',
                    borderRadius: 2,
                  }} />
                </span>
              )}
            </span>
          ) : stateBadge ? (
            <span
              className={`${styles.featureStateBadge} ${styles[`featureStateBadge_${stateBadge.tone}` as keyof typeof styles]}`}
              data-testid="feature-state"
              data-state={stateBadge.key}
              title={stateBadge.key === 'working' && aggregateSessions.length > 0 ? `${stateBadge.title} ${buildActivitySummary(aggregateSessions)}.` : stateBadge.title}
            >
              {stateBadge.label}
            </span>
          ) : null}
          {isReady && (
            <span data-section="MergeButton"><MergeButton
              issueId={feature.issueId}
              variant="card"
              onClick={(e) => e.stopPropagation()}
            /></span>
          )}
          {trainInfo && (
            <span
              className={`${styles.featureBadge} ${styles.featureBadge_stopped}`}
              data-testid="feature-train"
              title={`Merge train ${trainInfo.name} (${trainInfo.status}) — position ${trainInfo.order} of ${trainInfo.total}`}
            >
              🚆 {trainInfo.name} · {trainInfo.order}/{trainInfo.total}
            </span>
          )}
          <FeatureAppLink frontendUrl={workspace?.frontendUrl} summary={uatStackSummary} />
          {/* Merge-ready only — earlier phases have no stack, and a cached workspace query rendered a bogus chip for planning-phase issues (PAN-2996). */}
          {isReady && <FeatureUatChip summary={uatStackSummary} />}
          <span data-section="ResourceStrip"><ResourceCluster feature={feature} onCleanupOrphanedResources={onCleanupOrphanedResources} /></span>
          <span data-section="Pipeline pips" className={styles.featurePipe} data-testid="feature-pipe"
            role="img" title={pipelineLabel} aria-label={pipelineLabel}>
            {pipeline.map((seg, i) => (
              <i key={PIPE_ORDER[i]} className={PIPE_CLASS[seg] ? styles[PIPE_CLASS[seg] as keyof typeof styles] as string : undefined} title={`${PIPE_STEP_LABELS[i]}: ${describePipeSegment(seg)}`} />
            ))}
          </span>
          </span>
        </button>
      </ContextMenuTrigger>
      </div>
        </IssuePeek>
      </div>
      {expanded && (
        <div data-section="ShipDoorTreeRow"><RailShipProgress issueId={feature.issueId} onClick={() => onSelect?.()} /></div>
      )}
      {expanded && hasExpandableChildren && (
        <div className={styles.sessionList}>
          {(() => {
            const reviewerChildren = visibleSessions.filter(s => s.type === 'reviewer');
            // Sort non-reviewer sessions by type priority so review always precedes legacy
            const sortedNonReviewers = visibleSessions
              .filter(s => s.type !== 'reviewer')
              .sort((a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99));

            return (
              <>
                {hasVisibleSessions && sortedNonReviewers.map(session => {
                  if (session.type === 'review') {
                    return (
                      <ReviewGroup
                        key={session.sessionId}
                        parent={session}
                        children={reviewerChildren}
                        issueId={feature.issueId}
                        selectedSessionId={selectedSessionId}
                        onSelectSession={onSelectSession}
                        onStopSession={onStopSession}
                        onViewTerminal={onViewTerminal}
                        onPauseSession={onPauseSession}
                        onResumeSession={onResumeSession}
                        onUnpauseSession={onUnpauseSession}
                        onRestartSession={onRestartSession}
                        onDeepWipe={onDeepWipe}
                        onOpenStateDir={onOpenStateDir}
                        onViewJsonl={onViewJsonl}
                      />
                    );
                  }
                  return (
                    <ExpandableSessionNode
                      key={session.sessionId}
                      session={session}
                      issueId={feature.issueId}
                      isSelected={selectedSessionId === session.sessionId}
                      onClick={() => onSelectSession?.(feature.issueId, session.sessionId)}
                      onStopSession={onStopSession}
                      onViewTerminal={onViewTerminal}
                      onPauseSession={onPauseSession}
                      onResumeSession={onResumeSession}
                      onUnpauseSession={onUnpauseSession}
                      onRestartSession={onRestartSession}
                      onDeepWipe={onDeepWipe}
                      onOpenStateDir={onOpenStateDir}
                      onViewJsonl={onViewJsonl}
                      onOpenPlanDialog={onOpenPlanDialog}
                    />
                  );
                })}
                {hasConversations && <div data-section="Conversation rows">{issueConversations.map(conv => (
                  <a
                    key={`conv-${conv.id}`}
                    href={`/conv/${conv.id}`}
                    className={styles.sessionNode}
                    data-testid={`conversation-${conv.id}`}
                    title={conv.title ?? conv.name}
                  >
                    <span className={styles.sessionToggleSlot} /><span className={styles.sessionDotSlot} /><span className={styles.sessionIconSlot}><MessageSquare size={12} /></span>
                    <span className={styles.sessionLabel}>{conv.title || 'Conversation'}</span>
                    <span className={`${styles.sessionStatus} ${styles[`sessionStatus_${conv.status}`] ?? ''}`}>{conv.status}</span>
                    <span className={styles.sessionModel}>#{conv.id}</span>
                  </a>
                ))}</div>}
              </>
            );
          })()}
        </div>
      )}

      {shouldShowUatStack && uatStackSummary && (
        <div data-section="StackDrawer / UatStackTreeGroup"><UatStackTreeGroup
          summary={uatStackSummary}
          workspace={workspace}
          pending={Boolean(stackPending)}
          storageKey={`${getExpandedKey(feature.issueId)}:uat`}
          onActionSelect={createUatActionHandler({ issueId: feature.issueId, workspace, queryClient })}
        /></div>
      )}

      {expanded && hasResources && detailIdentifiers && (
        <div data-section="ResourcesGroup"><ResourcesGroup
          issueId={feature.issueId}
          defaultExpanded={aggregateSessions.length > 0 && activityState !== 'stopped'}
          containers={(detailIdentifiers.dockerContainerNames ?? []).map((name) => {
            const stats = containerStats?.[name];
            return {
              name,
              serviceName: parseContainerServiceName(name),
              status: stats?.status ?? 'running',
              cpuPercent: stats?.cpuPercent ?? 0,
              memoryUsage: stats?.memoryUsage ?? 0,
              id: stats?.id,
            };
          })}
          branches={[
            ...(detailIdentifiers.localBranchNames ?? []).map((name) => ({ name, isLocal: true as const })),
            ...(detailIdentifiers.remoteBranchNames ?? []).map((name) => ({ name, isLocal: false as const })),
          ]}
          prs={(detailIdentifiers.prs ?? feature.resourceDetails?.prs ?? []).map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            isDraft: pr.isDraft,
          }))}
        /></div>
      )}
    </IssueView>
    <FeatureContextMenu
      feature={feature}
      workSessionId={workSessionId}
      hasJsonl={hasJsonl}
      onOpenStateDir={onOpenStateDir}
      onViewJsonl={onViewJsonl}
      onStopSession={onStopSession}
      onResumeSession={onResumeSession}
      onRestartSession={onRestartSession}
      onOpenPlanDialog={onOpenPlanDialog}
    />
  </ContextMenuRoot>
);
}
