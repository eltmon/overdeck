import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import {
  Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge,
  ChevronRight, ChevronDown, FolderOpen, FileText, Trash2, GitBranch,
  BookText, Bug, Container, Radio, Workflow,
} from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers, ResourceSource } from './ProjectNode';
import type { Harness } from '../../shared/ModelPicker';
import { SessionNode } from './SessionNode';
import { type StatusDotStatus } from '../StatusDot';
import { ResourcesGroup } from './ResourcesGroup';
import { getUatStackSummary } from '../UatStackStatus';
import { UatStackTreeGroup } from './UatStackTreeGroup';
import { useWorkspaceQuery } from '../ZoneCOverviewTabs/queries';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDestructiveItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '../../shared/ContextMenu';
import { IssueActionDialogHost, useIssueActions, type IssueActionView } from '../../IssueActionMenu';
import { parseContainerServiceName } from '../../../lib/resource-utils';
import { useQuery } from '@tanstack/react-query';
import { MergeButton } from '../../MergeButton';
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

// ContextMenuState removed — migrated to Radix UI ContextMenu

const RESOURCE_ICON_ORDER: ResourceSource[] = ['workspace', 'branch', 'tmux', 'remote-agent', 'vbrief', 'beads', 'pr', 'docker'];

function resourceColor(_feature: ProjectFeature): string {
  // v1.2 color restraint: resources are infrastructure facts, not status —
  // always neutral. Exceptional states (CI failing) color individual chips.
  return 'var(--muted-foreground)';
}

function formatPrState(pr: { number: number; title: string; state: string; isDraft: boolean }): string {
  const normalizedState = pr.state.toLowerCase();
  return pr.isDraft ? `${normalizedState}, draft` : normalizedState;
}

function resourceSummary(feature: ProjectFeature, source: ResourceSource): { label: string; detail: string } | null {
  const details = feature.resourceDetails;
  if (!details) return null;
  switch (source) {
    case 'workspace':
      return details.hasWorkspace ? { label: 'workspace', detail: 'allocated' } : null;
    case 'branch': {
      const parts: string[] = [];
      if (details.localBranchCount > 0) parts.push(`local ${details.localBranchCount}`);
      if (details.remoteBranchCount > 0) parts.push(`remote ${details.remoteBranchCount}`);
      return parts.length > 0 ? { label: 'branch', detail: parts.join(' · ') } : null;
    }
    case 'tmux':
      return details.tmuxSessionCount > 0 ? { label: 'tmux', detail: `${details.tmuxSessionCount} session${details.tmuxSessionCount === 1 ? '' : 's'}` } : null;
    case 'vbrief':
      return details.hasVbrief ? { label: 'vBRIEF', detail: 'present' } : null;
    case 'beads':
      return details.hasBeads ? { label: 'beads', detail: 'present' } : null;
    case 'pr':
      return details.prs.length > 0
        ? {
            label: 'PR',
            detail: details.prs.map((pr) => `#${pr.number} (${formatPrState(pr)})`).join(' · '),
          }
        : null;
    case 'docker':
      return details.dockerContainerCount > 0 ? { label: 'docker', detail: `${details.dockerContainerCount} container${details.dockerContainerCount === 1 ? '' : 's'}` } : null;
    case 'remote-agent':
      return details.remoteAgent ? { label: 'fly.io', detail: `${details.remoteAgent.vmName} (${details.remoteAgent.status})` } : null;
    default:
      return null;
  }
}

function isOrphanedFeature(feature: ProjectFeature): boolean {
  const state = feature.stateLabel.toLowerCase();
  const rawState = feature.rawTrackerState?.toLowerCase() ?? '';
  return state.includes('closed') || state.includes('done') || rawState.includes('closed') || rawState.includes('done');
}

function ResourceIcon({ source, feature }: { source: ResourceSource; feature: ProjectFeature }) {
  const color = resourceColor(feature);
  const summary = resourceSummary(feature, source);
  if (!summary) return null;
  const props = { size: 12, color, 'aria-hidden': true as const };
  const icon = source === 'workspace' ? <FolderOpen {...props} />
    : source === 'branch' ? <GitBranch {...props} />
      : source === 'tmux' ? <Radio {...props} />
        : source === 'vbrief' ? <BookText {...props} />
          : source === 'beads' ? <Bug {...props} />
            : source === 'pr' ? <Workflow {...props} />
              : <Container {...props} />;
  return (
    <span className={styles.featureResourceChip} title={`${summary.label}: ${summary.detail}`}>
      {icon}
      <span>{source === 'pr' ? summary.detail.split(' ')[0] : source === 'branch' ? `branch ${summary.detail}` : source === 'docker' ? `stack ${summary.detail.split(' ')[0]}` : summary.label}</span>
    </span>
  );
}

function ResourceStrip({
  feature,
  onCleanupOrphanedResources,
}: {
  feature: ProjectFeature;
  onCleanupOrphanedResources?: (issueId: string) => void;
}) {
  const details = feature.resourceDetails;
  const resources = RESOURCE_ICON_ORDER.filter((source) => feature.resourceSources?.includes(source) && resourceSummary(feature, source));
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [detailIdentifiers, setDetailIdentifiers] = useState<ProjectFeatureResourceIdentifiers | null>(null);
  const orphaned = isOrphanedFeature(feature);
  const shouldRender = resources.length > 0;

  useEffect(() => {
    if (!shouldRender) return;
    if (!popoverOpen) return;
    if (!details) return;
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
        // Fall back to summary-only rows when detail fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, [shouldRender, popoverOpen, details, feature.issueId, detailIdentifiers]);

  const resourceRows = useMemo(() => {
    if (!details) return [] as Array<{ key: string; label: string }>;

    const identifiers = detailIdentifiers;
    const rows: Array<{ key: string; label: string }> = [];

    if ((identifiers?.workspacePaths.length ?? 0) > 0) {
      for (const workspacePath of identifiers?.workspacePaths ?? []) {
        rows.push({ key: `workspace-${workspacePath}`, label: `workspace: ${workspacePath}` });
      }
    } else if (details.hasWorkspace) {
      rows.push({ key: 'workspace', label: 'workspace allocated' });
    }

    if ((identifiers?.localBranchNames.length ?? 0) > 0 || (identifiers?.remoteBranchNames.length ?? 0) > 0) {
      for (const branchName of identifiers?.localBranchNames ?? []) {
        rows.push({ key: `local-branch-${branchName}`, label: `branch (local): ${branchName}` });
      }
      for (const branchName of identifiers?.remoteBranchNames ?? []) {
        rows.push({ key: `remote-branch-${branchName}`, label: `branch (remote): ${branchName}` });
      }
    } else if (details.localBranchCount > 0 || details.remoteBranchCount > 0) {
      rows.push({ key: 'branch', label: `branches: ${details.localBranchCount} local · ${details.remoteBranchCount} remote` });
    }

    if ((identifiers?.tmuxSessionNames.length ?? 0) > 0) {
      for (const sessionName of identifiers?.tmuxSessionNames ?? []) {
        rows.push({ key: `tmux-${sessionName}`, label: `tmux: ${sessionName}` });
      }
    } else if (details.tmuxSessionCount > 0) {
      rows.push({ key: 'tmux', label: `tmux: ${details.tmuxSessionCount} active session${details.tmuxSessionCount === 1 ? '' : 's'}` });
    }

    if (details.remoteAgent) {
      rows.push({ key: 'remote-agent', label: `fly.io: ${details.remoteAgent.vmName} · ${details.remoteAgent.status} · ${details.remoteAgent.model}` });
    }

    if (details.hasVbrief) rows.push({ key: 'vbrief', label: 'vBRIEF present' });
    if (details.hasBeads) rows.push({ key: 'beads', label: 'beads present' });
    for (const pr of identifiers?.prs ?? details.prs) {
      rows.push({ key: `pr-${pr.number}`, label: `PR: #${pr.number} ${pr.title} (${formatPrState(pr)})` });
    }

    if ((identifiers?.dockerContainerNames.length ?? 0) > 0) {
      for (const containerName of identifiers?.dockerContainerNames ?? []) {
        rows.push({ key: `docker-${containerName}`, label: `docker: ${containerName}` });
      }
    } else if (details.dockerContainerCount > 0) {
      rows.push({ key: 'docker', label: `docker: ${details.dockerContainerCount} running container${details.dockerContainerCount === 1 ? '' : 's'}` });
    }

    return rows;
  }, [details, detailIdentifiers]);

  if (!shouldRender) return null;

  return (
    <span
      className={`${styles.featureResourceStrip} ${styles.featureResourceLine}`}
      onMouseEnter={() => setPopoverOpen(true)}
      onMouseLeave={() => setPopoverOpen(false)}
      onFocus={() => setPopoverOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPopoverOpen(false);
        }
      }}
    >
      {resources.map((source) => (
        <ResourceIcon key={source} source={source} feature={feature} />
      ))}
      {details && popoverOpen && (
        <span className={styles.featureResourcePopover}>
          {resourceRows.map((row) => (
            <span key={row.key} className={styles.featureResourceRow}>
              <span>{row.label}</span>
              {orphaned && onCleanupOrphanedResources && !row.key.startsWith('pr-') && (
                <button
                  type="button"
                  className={styles.featureResourceCleanupButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCleanupOrphanedResources(feature.issueId);
                  }}
                  title={`Clean up orphaned ${row.key} resources`}
                >
                  Cleanup
                </button>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function StatusIcon({ status, agentStatus, stateLabel, isRally, readyForMerge }: { status: string; agentStatus: string | null; stateLabel: string; isRally?: boolean; readyForMerge?: boolean }) {
  // Merge-ready takes precedence — human action needed
  if (readyForMerge) {
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
function formatPausedAge(pausedAt?: string): string | null {
  if (!pausedAt) return null;
  const ms = Date.now() - new Date(pausedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatRoleList(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  if (roles.length === 1) return roles[0]!;
  if (roles.length === 2) return `${roles[0]} and ${roles[1]}`;
  return `${roles.slice(0, -1).join(', ')}, and ${roles[roles.length - 1]}`;
}

function isWorkOrSpecialistSession(session: SessionNodeType): boolean {
  return session.type === 'work'
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

function getFeatureStateTone(stateLabel: string): 'done' | 'progress' | 'review' | 'context' | 'planning' | 'todo' {
  const normalized = stateLabel.trim().toLowerCase();
  if (normalized === 'done') return 'done';
  if (normalized === 'in progress' || normalized === 'active') return 'progress';
  if (normalized === 'in review' || normalized === 'review' || normalized === 'verifying' || normalized === 'verifying on main') return 'review';
  if (normalized === 'has context') return 'context';
  if (normalized === 'planning') return 'planning';
  return 'todo';
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

function getFeatureStateTitle(feature: ProjectFeature, aggregateSessions: readonly SessionNodeType[]): string | undefined {
  const normalized = feature.stateLabel.trim().toLowerCase();
  const contextParts = [
    feature.hasPrd ? 'PRD' : null,
    feature.hasState ? 'continue file' : null,
    feature.resourceDetails?.hasVbrief ? 'vBRIEF' : null,
    feature.resourceDetails?.hasBeads ? 'beads' : null,
  ].filter((part): part is string => part !== null);
  const contextSuffix = contextParts.length > 0 ? ` Context present: ${contextParts.join(', ')}.` : '';

  if (normalized === 'planning') {
    return `Planning context is being prepared for this issue.${contextSuffix}`;
  }
  if (normalized === 'has context') {
    return `Planning artifacts exist for this issue, but active implementation or review has not started yet.${contextSuffix}`;
  }
  if (normalized === 'verifying' || normalized === 'verifying on main') {
    return 'The merge has landed and this issue is awaiting main-branch verification and close-out.';
  }
  if (normalized === 'in review' || normalized === 'review') {
    return feature.readyForMerge
      ? 'Implementation has moved into review/test/merge flow and is ready for human merge approval.'
      : 'Implementation has moved into the review/test/merge pipeline for verification.';
  }
  if (normalized === 'in progress' || normalized === 'active') {
    return aggregateSessions.length > 0
      ? `Implementation work is active or resumable for this issue. ${buildActivitySummary(aggregateSessions)}.`
      : `Implementation work is active for this issue.${contextSuffix}`;
  }
  if (normalized === 'done') {
    return 'Tracker state is done for this issue.';
  }
  return `Tracker state: ${feature.stateLabel}.${contextSuffix}`;
}

const TYPE_PRIORITY: Record<string, number> = {
  work: 0,
  strike: 1,
  review: 2,
  test: 3,
  reviewer: 4,
  planning: 5,
  ship: 6,
  merge: 7,
  legacy: 8,
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

/** Compute the dominant session presence for the feature row StatusDot.
 *  Priority: active > thinking > waiting > idle > ended. */
function computeDominantStatus(sessions: readonly SessionNodeType[]): StatusDotStatus {
  let hasIdle = false;
  let hasThinking = false;
  let hasWaiting = false;
  for (const s of sessions) {
    if (s.awaitingInput === true) hasWaiting = true;
    if (s.presence === 'active' && s.awaitingInput !== true) return 'active';
    if (s.presence === 'idle') hasIdle = true;
    const st = (s.status || '').toLowerCase();
    if (st.includes('thinking')) hasThinking = true;
    if (st.includes('waiting')) hasWaiting = true;
  }
  if (hasThinking) return 'thinking';
  if (hasWaiting) return 'waiting';
  if (hasIdle) return 'idle';
  return 'ended';
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
  onDeepWipe?: (issueId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onOpenPlanDialog?: (issueId: string) => void;
}

function FeatureIssueActionItems({ views }: { views: IssueActionView[] }) {
  return (
    <>
      {views.map((view) => {
        const label = view.isPending ? `${view.action.label}…` : view.action.label;
        const disabled = !view.enabled || view.isPending;
        const props = {
          key: view.action.key,
          disabled,
          onSelect: () => view.invoke(),
        };

        if (view.action.kind === 'destructive' || view.action.group === 'danger') {
          return <ContextMenuDestructiveItem {...props}>{label}</ContextMenuDestructiveItem>;
        }
        return <ContextMenuItem {...props}>{label}</ContextMenuItem>;
      })}
    </>
  );
}

function FeatureContextMenu({
  feature,
  workSessionId,
  hasJsonl,
  onOpenStateDir,
  onViewJsonl,
  onDeepWipe,
}: FeatureContextMenuProps) {
  const issueActions = useIssueActions(feature.issueId);
  const issueActionViews = useMemo(
    () => [...issueActions.primary, ...issueActions.secondary, ...issueActions.overflow],
    [issueActions.primary, issueActions.secondary, issueActions.overflow],
  );

  const handleDeepWipe = useCallback(() => {
    if (!onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${feature.issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(feature.issueId);
    }
  }, [feature.issueId, onDeepWipe]);

  const hasUtilityActions = (workSessionId && (onOpenStateDir || (hasJsonl && onViewJsonl))) || onDeepWipe;

  return (
    <>
      <ContextMenuContent>
        <ContextMenuLabel>Issue actions</ContextMenuLabel>
        <FeatureIssueActionItems views={issueActionViews} />

        {hasUtilityActions ? <ContextMenuSeparator /> : null}

        {workSessionId && onOpenStateDir && (
          <ContextMenuItem onSelect={() => onOpenStateDir(workSessionId)}>
            <FolderOpen size={12} className="mr-2" />
            Open State Dir
          </ContextMenuItem>
        )}

        {hasJsonl && workSessionId && onViewJsonl && (
          <ContextMenuItem onSelect={() => onViewJsonl(workSessionId)}>
            <FileText size={12} className="mr-2" />
            View JSONL
          </ContextMenuItem>
        )}

        {onDeepWipe && (
          <ContextMenuDestructiveItem onSelect={handleDeepWipe}>
            <Trash2 size={12} className="mr-2" />
            Deep Wipe
          </ContextMenuDestructiveItem>
        )}
      </ContextMenuContent>
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
    <div>
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
      const res = await fetch('/api/flywheel/uat-generations');
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ name: string; status: string; members?: Array<{ issueId: string; mergeOrder: number }> }>>;
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

type PipeSegState = 'none' | 'done' | 'working' | 'paused' | 'error' | 'merged';
const PIPE_ORDER = ['planning', 'work', 'review', 'test', 'ship'] as const;

/** Per-issue plan→work→review→test→ship strip. Earlier phases read done;
 *  only the live phase carries a signal color (v1.2 color restraint). */
export function derivePipeline(feature: ProjectFeature, sessions: readonly SessionNodeType[]): PipeSegState[] {
  const isDone = feature.stateLabel.toLowerCase().includes('done');
  if (isDone) return ['done', 'done', 'done', 'done', 'merged'];

  const byPhase = PIPE_ORDER.map((phase) =>
    sessions.filter((s) => s.type === phase || (phase === 'planning' && s.type === 'legacy') || (phase === 'review' && s.type === 'reviewer')),
  );
  if (feature.hasPlanning && byPhase[0].length === 0) {
    byPhase[0] = [{ status: 'stopped' } as SessionNodeType];
  }
  let lastIdx = -1;
  for (let i = 0; i < byPhase.length; i++) {
    if (byPhase[i].length > 0) lastIdx = i;
  }
  if (feature.readyForMerge) lastIdx = 4;

  return PIPE_ORDER.map((_, i) => {
    if (lastIdx === -1) return 'none';
    if (i < lastIdx) return 'done';
    if (i > lastIdx) return 'none';
    if (feature.readyForMerge && i === 4) return 'done';
    const phaseSessions = byPhase[i];
    if (phaseSessions.length === 0) return 'done';
    if (phaseSessions.some((s) => s.paused === true)) return 'paused';
    if (phaseSessions.some((s) => s.status === 'error')) return 'error';
    if (phaseSessions.some((s) => s.status === 'running' || s.status === 'starting')) return 'working';
    return 'done';
  });
}

const PIPE_CLASS: Record<PipeSegState, string> = {
  none: '',
  done: 'pipeDone',
  working: 'pipeWorking',
  paused: 'pipePaused',
  error: 'pipeError',
  merged: 'pipeMerged',
};

export function FeatureItem({ feature, isSelected, onSelect, selectedSessionId, onSelectSession, title, cost, filter = 'all', onStopSession, onViewTerminal, onPauseSession, onResumeSession, onUnpauseSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl, onCleanupOrphanedResources, onOpenPlanDialog, containerStats }: FeatureItemProps) {
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

  // Derive best session once per data change instead of on every click (PAN-821 review)
  // Respect the tree filter so auto-select picks a visible session.
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

  const workSession = feature.sessions?.find((s) => s.type === 'work');
  const workSessionId = workSession?.sessionId ?? bestSessionId ?? null;

  // PAN-1779: surface the pause gate at the issue level — paused agents are
  // deliberately parked and must never read as generic "stopped".
  const pausedSession = feature.sessions?.find((s) => s.paused === true);
  const pausedAge = formatPausedAge(pausedSession?.pausedAt);

  const aggregateSessions = feature.sessions?.filter(isWorkOrSpecialistSession) ?? [];
  const activityState = getAggregateActivityState(aggregateSessions);
  const activitySummary = buildActivitySummary(aggregateSessions);
  const aggregateBadges = getAggregateBadges(aggregateSessions);
  const featureStateTone = getFeatureStateTone(feature.stateLabel);

  // Dominant session state for the feature row StatusDot (blocker-7)
  const dominantStatus = feature.sessions && feature.sessions.length > 0
    ? computeDominantStatus(feature.sessions)
    : null;

  // PAN-1779 redesign: the wrapper edge bar is the row's one colored signal.
  // Priority: error (red) > paused/ready (amber human gates) > done (emerald)
  // > working (blue machine activity).
  const isDoneState = feature.stateLabel.toLowerCase().includes('done');
  const hasErrorSession = aggregateSessions.some(isErrorSession);
  const hasRunningSession = aggregateSessions.some(isRunningSession);
  const edgeClass = (hasErrorSession
    ? styles.featureItemWrapperError
    : pausedSession
      ? styles.featureItemWrapperPaused
      : feature.readyForMerge
        ? styles.featureItemWrapperReady
        : isDoneState
          ? styles.featureItemWrapperMerged
          : hasRunningSession
            ? styles.featureItemWrapperWorking
            : '') ?? '';

  const pipeline = useMemo(
    () => derivePipeline(feature, feature.sessions ?? []),
    [feature],
  );
  const trainInfo = useUatTrainMembership().get(feature.issueId.toUpperCase());
  const shouldShowUatStack = expanded && feature.readyForMerge && Boolean(feature.resourceDetails?.hasWorkspace);
  const workspaceQuery = useWorkspaceQuery(feature.issueId, {
    enabled: shouldShowUatStack,
  });
  const workspace = workspaceQuery.data;
  const stackPending = workspace?.pendingOperation?.status === 'running' && (
    workspace.pendingOperation.type === 'containerize' ||
    workspace.pendingOperation.type === 'start' ||
    workspace.pendingOperation.type === 'rebuild-stack'
  );
  const uatStackSummary = getUatStackSummary({
    containers: workspace?.containers,
    stackHealth: workspace?.stackHealth,
    pending: stackPending,
  });

  // Live flash when dominant status or visible session count changes (blocker-8)
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
      <div
        className={`${styles.featureItemWrapper} ${edgeClass} ${isSelected ? styles.featureItemWrapperSelected : ''} ${flashClass}`}
        data-component="feature-item"
        data-issue-id={feature.issueId}
      >
        <div className={styles.featureItemRow}>
          {hasVisibleSessions ? (
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
                <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} isRally={feature.isRally} readyForMerge={feature.readyForMerge} />
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
          {!feature.isRally && aggregateBadges.length > 0 && (
            <span className={styles.featureBadgeGroup}>
              {aggregateBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`${styles.featureBadge} ${styles[`featureBadge_${badge.tone}` as keyof typeof styles]}`}
                  title={getAggregateBadgeTitle(badge, aggregateSessions)}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          )}
          {pausedSession && (
            <span className={styles.featureBadgeGroup} data-testid="feature-paused">
              <span
                className={`${styles.featureBadge} ${styles.featureBadge_paused}`}
                title={pausedSession.pausedReason ? `Paused: ${pausedSession.pausedReason}` : 'Agent is paused'}
              >
                ⏸ Paused{pausedAge ? ` ${pausedAge}` : ''}
              </span>
              {onUnpauseSession && (
                <span
                  role="button"
                  tabIndex={-1}
                  data-testid="feature-unpause"
                  className={styles.unpauseBtn}
                  title={pausedSession.pausedReason ? `Unpause — paused: ${pausedSession.pausedReason}` : 'Unpause this agent'}
                  onClick={(e) => { e.stopPropagation(); onUnpauseSession(pausedSession.sessionId); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onUnpauseSession(pausedSession.sessionId); } }}
                >
                  ▶ Unpause
                </span>
              )}
            </span>
          )}
          {feature.isRally && feature.childCount != null && feature.childCount > 0 ? (
            <span className={styles.featureState} title={`${feature.completedCount || 0}/${feature.childCount} stories done${feature.inProgressCount ? `, ${feature.inProgressCount} active` : ''}${progressPct !== null ? ` (${progressPct}% complete)` : ''}`}>
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
          ) : (
            <span
              className={`${styles.featureState} ${styles[`featureState_${featureStateTone}` as keyof typeof styles]}`}
              title={getFeatureStateTitle(feature, aggregateSessions)}
            >
              {feature.stateLabel}
            </span>
          )}
          {feature.readyForMerge && !pausedSession && (
            <span
              className={`${styles.featureBadge} ${styles.featureBadge_paused}`}
              data-testid="feature-ready"
              title="All gates passed — awaiting your merge"
            >
              Ready · awaiting merge
            </span>
          )}
          {feature.readyForMerge && (
            <MergeButton
              issueId={feature.issueId}
              variant="card"
              reviewStatus={{ readyForMerge: true }}
              onClick={(e) => e.stopPropagation()}
            />
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
          {uatStackSummary && (
            <span
              className={`${styles.featureBadge} ${uatStackSummary.active ? styles.featureBadge_paused : styles.featureBadge_running}`}
              data-testid="feature-uat-stack"
              title="UAT workspace Docker stack status"
            >
              {uatStackSummary.active ? 'UAT starting' : 'UAT healthy'}
            </span>
          )}
          <span className={styles.featurePipe} data-testid="feature-pipe" title="plan · work · review · test · ship">
            {pipeline.map((seg, i) => (
              <i key={PIPE_ORDER[i]} className={PIPE_CLASS[seg] ? styles[PIPE_CLASS[seg] as keyof typeof styles] as string : undefined} />
            ))}
          </span>
          </span>
        </button>
      </ContextMenuTrigger>
      </div>
      <ResourceStrip feature={feature} onCleanupOrphanedResources={onCleanupOrphanedResources} />

      {expanded && hasVisibleSessions && (
        <div className={styles.sessionList}>
          {(() => {
            const reviewerChildren = visibleSessions.filter(s => s.type === 'reviewer');
            // Sort non-reviewer sessions by type priority so review always precedes legacy
            const sortedNonReviewers = visibleSessions
              .filter(s => s.type !== 'reviewer')
              .sort((a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99));

            return (
              <>
                {sortedNonReviewers.map(session => {
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
                    <SessionNode
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
              </>
            );
          })()}
        </div>
      )}

      {shouldShowUatStack && uatStackSummary && (
        <UatStackTreeGroup
          summary={uatStackSummary}
          workspace={workspace}
          pending={Boolean(stackPending)}
          storageKey={`${getExpandedKey(feature.issueId)}:uat`}
        />
      )}

      {expanded && hasResources && detailIdentifiers && (
        <ResourcesGroup
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
        />
      )}
    </div>
    <FeatureContextMenu
      feature={feature}
      workSessionId={workSessionId}
      hasJsonl={hasJsonl}
      onOpenStateDir={onOpenStateDir}
      onViewJsonl={onViewJsonl}
      onDeepWipe={onDeepWipe}
      onStopSession={onStopSession}
      onResumeSession={onResumeSession}
      onRestartSession={onRestartSession}
      onOpenPlanDialog={onOpenPlanDialog}
    />
  </ContextMenuRoot>
);
}
