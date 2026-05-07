import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge,
  ChevronRight, ChevronDown, FolderOpen, FileText, Trash2, GitBranch,
  BookText, Bug, Container, Radio, Workflow, Play, RefreshCw, RotateCcw,
  XCircle, ClipboardCheck, Zap,
} from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers, ResourceSource } from './ProjectNode';
import { SessionNode } from './SessionNode';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { useAvailableModels } from '../../shared/ModelPicker/ModelPicker';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDestructiveItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../../shared/ContextMenu';
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state';
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
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onCleanupOrphanedResources?: (issueId: string) => void;
  onOpenPlanDialog?: (issueId: string) => void;
}

// ContextMenuState removed — migrated to Radix UI ContextMenu

const RESOURCE_ICON_ORDER: ResourceSource[] = ['workspace', 'branch', 'tmux', 'vbrief', 'beads', 'pr', 'docker'];

function resourceColor(feature: ProjectFeature): string {
  const state = feature.stateLabel.toLowerCase();
  if (state.includes('closed') || state.includes('done')) return 'var(--muted-foreground)';
  if (state.includes('review')) return 'var(--primary)';
  if (state.includes('progress')) return 'var(--success)';
  if (state.includes('suspend')) return 'var(--warning)';
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
    <span className={styles.featureResourceIcon} title={`${summary.label}: ${summary.detail}`}>
      {icon}
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
      className={styles.featureResourceStrip}
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
  | { key: 'work'; label: string; tone: 'running' | 'stopped' }
  | { key: 'reviewers'; label: string; tone: 'running' | 'stopped' }
  | { key: 'review-error'; label: string; tone: 'error' };

function formatRoleList(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  if (roles.length === 1) return roles[0]!;
  if (roles.length === 2) return `${roles[0]} and ${roles[1]}`;
  return `${roles.slice(0, -1).join(', ')}, and ${roles[roles.length - 1]}`;
}

function isWorkOrSpecialistSession(session: SessionNodeType): boolean {
  return session.type === 'work'
    || session.type === 'planning'
    || session.type === 'review'
    || session.type === 'reviewer'
    || session.type === 'test'
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
  if (sessions.some(isRunningSession)) return 'running';
  if (sessions.some(isQueuedSession)) return 'queued';
  return 'stopped';
}

function getActivityDotStatus(state: AggregateActivityState): StatusDotStatus {
  if (state === 'running') return 'active';
  if (state === 'queued') return 'waiting';
  return 'ended';
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
  if (normalized === 'in review' || normalized === 'review') return 'review';
  if (normalized === 'has context') return 'context';
  if (normalized === 'planning') return 'planning';
  return 'todo';
}

function getAggregateBadgeTitle(badge: AggregateBadge, sessions: readonly SessionNodeType[]): string {
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
  review: 1,
  test: 2,
  reviewer: 3,
  planning: 4,
  merge: 5,
  legacy: 6,
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
  return s.includes('progress') || s.includes('review') || s.includes('testing');
}

/** Compute the dominant session presence for the feature row StatusDot.
 *  Priority: active > thinking > waiting > idle > ended. */
function computeDominantStatus(sessions: readonly SessionNodeType[]): StatusDotStatus {
  let hasIdle = false;
  let hasThinking = false;
  let hasWaiting = false;
  for (const s of sessions) {
    if (s.presence === 'active') return 'active';
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
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => void;
}

function StartModelSubmenu({
  onStart,
}: {
  onStart: (model?: string) => void;
}) {
  const { groups } = useAvailableModels();

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Start with Model…</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => onStart()}>
          <span className="flex-1">Default model</span>
        </ContextMenuItem>
        {groups.map((group) => (
          <div key={group.provider}>
            <ContextMenuLabel>{group.label}</ContextMenuLabel>
            {group.models.map((m) => (
              <ContextMenuItem key={m.id} onSelect={() => onStart(m.id)}>
                <span className="flex-1">{m.label}</span>
                {m.costDisplay && (
                  <span className="ml-2 shrink-0 text-[10px] opacity-50">{m.costDisplay}</span>
                )}
              </ContextMenuItem>
            ))}
          </div>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function FeatureContextMenu({
  feature,
  workSessionId,
  hasJsonl,
  onOpenStateDir,
  onViewJsonl,
  onDeepWipe,
  onStopSession,
  onResumeSession,
  onRestartSession,
}: FeatureContextMenuProps) {
  const queryClient = useQueryClient();
  const { groups } = useAvailableModels();

  const agentRunning = feature.agentStatus === 'running';
  const agentStopped = feature.agentStatus === 'stopped';
  const hasAgent = !!feature.agentStatus;

  const startAgentMutation = useMutation({
    mutationFn: async (model?: string) => {
      const body: Record<string, unknown> = { issueId: feature.issueId };
      if (model) body.model = model;
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to start agent');
      return data;
    },
    onSuccess: () => {
      void refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${encodeURIComponent(feature.issueId)}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as { error?: string; success?: boolean; message?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to start review');
      if (data.success === false) throw new Error(data.message || 'Review was not started');
      return data;
    },
    onSuccess: () => {
      void refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const recoverMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${encodeURIComponent(feature.issueId)}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerun: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Failed to recover pipeline');
      }
      return res.json();
    },
    onSuccess: () => {
      void refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const completePlanningMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${encodeURIComponent(feature.issueId)}/complete-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to complete planning');
      return data;
    },
    onSuccess: () => {
      toast.success(`Planning complete for ${feature.issueId}`);
      void refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const swarmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: feature.issueId }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dispatched?: number; slots?: unknown[] };
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch swarm');
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Swarm dispatched for ${feature.issueId}: ${(data as any).dispatched ?? 0} slot(s)`);
      void refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const handleDeepWipe = useCallback(() => {
    if (!onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${feature.issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(feature.issueId);
    }
  }, [feature.issueId, onDeepWipe]);

  const isRecoverable = feature.sessions?.some(
    s => (s.type === 'review' || s.type === 'reviewer') && isErrorSession(s),
  ) ?? false;

  return (
    <ContextMenuContent>
      {/* Lifecycle actions */}
      {agentRunning && workSessionId && onStopSession && (
        <ContextMenuItem onSelect={() => onStopSession(workSessionId)}>
          <XCircle size={12} className="mr-2" />
          Stop Agent
        </ContextMenuItem>
      )}

      {agentStopped && workSessionId && onResumeSession && (
        <ContextMenuItem onSelect={() => onResumeSession(workSessionId)}>
          <Play size={12} className="mr-2" />
          Resume Session
        </ContextMenuItem>
      )}

      {!hasAgent && (
        <ContextMenuItem onSelect={() => startAgentMutation.mutate(undefined)} disabled={startAgentMutation.isPending}>
          {startAgentMutation.isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <Play size={12} className="mr-2" />}
          Start Agent
        </ContextMenuItem>
      )}

      {/* Start/Resume with Model submenu */}
      {(!hasAgent || agentStopped) && (
        <StartModelSubmenu onStart={(model) => startAgentMutation.mutate(model)} />
      )}

      {agentRunning && workSessionId && onRestartSession && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Switch Model…</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {groups.map((group) => (
              <div key={group.provider}>
                <ContextMenuLabel>{group.label}</ContextMenuLabel>
                {group.models.map((m) => (
                  <ContextMenuItem key={m.id} onSelect={() => onRestartSession(workSessionId, feature.issueId, 'work', undefined, m.id)}>
                    <span className="flex-1">{m.label}</span>
                    {m.costDisplay && (
                      <span className="ml-2 shrink-0 text-[10px] opacity-50">{m.costDisplay}</span>
                    )}
                  </ContextMenuItem>
                ))}
              </div>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      {/* Pipeline actions */}
      {(agentRunning || agentStopped || !hasAgent) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
            {reviewMutation.isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <RefreshCw size={12} className="mr-2" />}
            Review & Test
          </ContextMenuItem>
        </>
      )}

      {isRecoverable && (
        <ContextMenuItem onSelect={() => recoverMutation.mutate()} disabled={recoverMutation.isPending}>
          {recoverMutation.isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <RotateCcw size={12} className="mr-2" />}
          Recover
        </ContextMenuItem>
      )}

      {/* Plan actions */}
      {(feature.hasPlanning || feature.resourceDetails?.hasVbrief) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <BookText size={12} className="mr-2" />
              Plan
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onSelect={() => completePlanningMutation.mutate()}
                disabled={completePlanningMutation.isPending || !feature.resourceDetails?.hasVbrief || !feature.resourceDetails?.hasBeads}
              >
                {completePlanningMutation.isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <ClipboardCheck size={12} className="mr-2" />}
                Done Planning
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      {/* Swarm action */}
      {feature.resourceDetails?.hasVbrief && (
        <ContextMenuItem
          onSelect={() => swarmMutation.mutate()}
          disabled={swarmMutation.isPending}
        >
          {swarmMutation.isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <Zap size={12} className="mr-2" />}
          Swarm
        </ContextMenuItem>
      )}

      {/* Utility actions */}
      <ContextMenuSeparator />

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
        <>
          <ContextMenuSeparator />
          <ContextMenuDestructiveItem onSelect={handleDeepWipe}>
            <Trash2 size={12} className="mr-2" />
            Deep Wipe
          </ContextMenuDestructiveItem>
        </>
      )}
    </ContextMenuContent>
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
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <SessionNode
        session={parent}
        issueId={issueId}
        isSelected={selectedSessionId === parent.sessionId}
        onClick={() => onSelectSession?.(issueId, parent.sessionId)}
        onStopSession={onStopSession}
        onViewTerminal={onViewTerminal}
        onPauseSession={onPauseSession}
        onResumeSession={onResumeSession}
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

export function FeatureItem({ feature, isSelected, onSelect, selectedSessionId, onSelectSession, title, cost, filter = 'all', onStopSession, onViewTerminal, onPauseSession, onResumeSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl, onCleanupOrphanedResources, onOpenPlanDialog }: FeatureItemProps) {
  const trimmedTitle = title?.trim() ?? '';
  const displayTitle = trimmedTitle || '(untitled)';
  const titleClassName = trimmedTitle
    ? styles.featureLabel
    : `${styles.featureLabel} ${styles.featureLabelUntitled}`;

  const [expanded, setExpanded] = useState(() => {
    const persisted = readExpanded(feature.issueId);
    return persisted ?? defaultExpandedFromState(feature.stateLabel);
  });

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

  const aggregateSessions = feature.sessions?.filter(isWorkOrSpecialistSession) ?? [];
  const activityState = getAggregateActivityState(aggregateSessions);
  const activitySummary = buildActivitySummary(aggregateSessions);
  const aggregateBadges = getAggregateBadges(aggregateSessions);
  const featureStateTone = getFeatureStateTone(feature.stateLabel);

  // Dominant session state for the feature row StatusDot (blocker-7)
  const dominantStatus = feature.sessions && feature.sessions.length > 0
    ? computeDominantStatus(feature.sessions)
    : null;

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
      <div className={`${styles.featureItemWrapper} ${isSelected ? styles.featureItemWrapperSelected : ''} ${flashClass}`}>
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
          <span className={styles.featureStatus}>
            {feature.isShadow ? (
              <Eye size={14} style={{ color: 'var(--primary)' }} />
            ) : feature.isRally ? (
              <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} isRally={feature.isRally} readyForMerge={feature.readyForMerge} />
            ) : aggregateSessions.length > 0 ? (
              <StatusDot status={getActivityDotStatus(activityState)} title={activitySummary} className={activityState === 'error' ? styles.featureActivityError : undefined} />
            ) : dominantStatus ? (
              <StatusDot status={dominantStatus} title={activitySummary} />
            ) : (
              <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} readyForMerge={feature.readyForMerge} />
            )}
          </span>
          <span className={styles.featureId_sidebar}>{feature.issueId}</span>
          <span className={titleClassName} title={displayTitle}>
            {displayTitle}
          </span>
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
          {cost !== undefined && cost > 0 && (
            <span className={styles.featureCost}>{formatCost(cost)}</span>
          )}
        </button>
      </ContextMenuTrigger>
      <ResourceStrip feature={feature} onCleanupOrphanedResources={onCleanupOrphanedResources} />
      </div>

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
    />
  </ContextMenuRoot>
);
}
