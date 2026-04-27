import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import { Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge, ChevronRight, ChevronDown, FolderOpen, FileText, Trash2, GitBranch, BookText, Bug, Container, Radio, Workflow } from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import type { ProjectFeature, ResourceSource } from './ProjectNode';
import { SessionNode } from './SessionNode';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
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
  onRestartSession?: (sessionId: string, issueId: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  open: boolean;
}

const RESOURCE_ICON_ORDER: ResourceSource[] = ['workspace', 'branch', 'tmux', 'vbrief', 'beads', 'pr', 'docker'];

function resourceColor(feature: ProjectFeature): string {
  const state = feature.stateLabel.toLowerCase();
  if (state.includes('closed') || state.includes('done')) return 'var(--mc-text-muted)';
  if (state.includes('review')) return 'var(--mc-accent)';
  if (state.includes('progress')) return 'var(--mc-success)';
  if (state.includes('suspend')) return 'var(--mc-warning)';
  return 'var(--mc-text-secondary)';
}

function resourceSummary(feature: ProjectFeature, source: ResourceSource): { label: string; detail: string } | null {
  const details = feature.resourceDetails;
  if (!details) return null;
  switch (source) {
    case 'workspace':
      return details.workspacePath ? { label: 'workspace', detail: details.workspacePath } : null;
    case 'branch': {
      const parts: string[] = [];
      if (details.localBranches.length > 0) parts.push(`local ${details.localBranches.length}`);
      if (details.remoteBranches.length > 0) parts.push(`remote ${details.remoteBranches.length}`);
      return parts.length > 0 ? { label: 'branch', detail: parts.join(' · ') } : null;
    }
    case 'tmux':
      return details.tmuxSessions.length > 0 ? { label: 'tmux', detail: `${details.tmuxSessions.length} session${details.tmuxSessions.length === 1 ? '' : 's'}` } : null;
    case 'vbrief':
      return details.vbriefPath ? { label: 'vBRIEF', detail: 'plan.vbrief.json' } : null;
    case 'beads':
      return details.beadsPath ? { label: 'beads', detail: 'issues.jsonl' } : null;
    case 'pr':
      return details.pr ? { label: 'PR', detail: `#${details.pr.number} ${details.pr.state.toLowerCase()}` } : null;
    case 'docker':
      return details.dockerContainers.length > 0 ? { label: 'docker', detail: `${details.dockerContainers.length} container${details.dockerContainers.length === 1 ? '' : 's'}` } : null;
    default:
      return null;
  }
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

function ResourceStrip({ feature }: { feature: ProjectFeature }) {
  const resources = RESOURCE_ICON_ORDER.filter((source) => feature.resourceSources?.includes(source) && resourceSummary(feature, source));
  if (resources.length === 0) return null;

  const details = feature.resourceDetails;
  return (
    <span className={styles.featureResourceStrip}>
      {resources.map((source) => (
        <ResourceIcon key={source} source={source} feature={feature} />
      ))}
      {details && (
        <span className={styles.featureResourcePopover}>
          {details.workspacePath && <span>workspace: {details.workspacePath}</span>}
          {details.localBranches.map((branch) => <span key={`local-${branch}`}>branch: {branch}</span>)}
          {details.remoteBranches.map((branch) => <span key={`remote-${branch}`}>remote: {branch}</span>)}
          {details.tmuxSessions.map((session) => <span key={`tmux-${session}`}>tmux: {session}</span>)}
          {details.vbriefPath && <span>vBRIEF: {details.vbriefPath}</span>}
          {details.beadsPath && <span>beads: {details.beadsPath}</span>}
          {details.pr && <span>PR: #{details.pr.number} {details.pr.title}</span>}
          {details.dockerContainers.map((container) => <span key={`docker-${container}`}>docker: {container}</span>)}
        </span>
      )}
    </span>
  );
}

function StatusIcon({ status, agentStatus, stateLabel, isRally, readyForMerge }: { status: string; agentStatus: string | null; stateLabel: string; isRally?: boolean; readyForMerge?: boolean }) {
  // Merge-ready takes precedence — human action needed
  if (readyForMerge) {
    return <GitMerge size={14} style={{ color: 'var(--mc-accent)' }} />;
  }
  // Rally feature: layers icon with color based on state
  if (isRally) {
    const color = stateLabel === 'Done' ? 'var(--mc-success)'
      : stateLabel === 'In Progress' ? 'var(--mc-warning)'
      : 'var(--mc-text-muted)';
    return <Layers size={14} style={{ color }} />;
  }
  // Green spinner: only when agent is truly actively running
  if (status === 'running') {
    return <Loader2 size={14} className={styles.spinning} style={{ color: 'var(--mc-success)' }} />;
  }
  // Yellow triangle: agent exists but not actively working (suspended, idle with session, needs attention)
  if (agentStatus === 'suspended' || stateLabel === 'In Progress' || stateLabel === 'Suspended') {
    return <AlertTriangle size={14} style={{ color: 'var(--mc-warning)' }} />;
  }
  // Check: has planning context
  if (status === 'has_state') {
    return <CheckCircle2 size={14} style={{ color: 'var(--mc-text-muted)' }} />;
  }
  // Default: empty circle
  return <Circle size={14} style={{ color: 'var(--mc-text-muted)' }} />;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

type AggregateActivityState = 'running' | 'error' | 'queued' | 'stopped';

type AggregateBadge =
  | { key: 'work'; label: string; tone: 'running' | 'stopped' }
  | { key: 'reviewers'; label: string; tone: 'running' | 'stopped' }
  | { key: 'review-error'; label: string; tone: 'error' };

function isWorkOrSpecialistSession(session: SessionNodeType): boolean {
  return session.type === 'work'
    || session.type === 'planning'
    || session.type === 'review'
    || session.type === 'reviewer'
    || session.type === 'test'
    || session.type === 'merge';
}

function isErrorSession(session: SessionNodeType): boolean {
  const status = session.status.toLowerCase();
  return status === 'error' || status.includes('fail') || status.includes('stuck');
}

function isQueuedSession(session: SessionNodeType): boolean {
  const status = session.status.toLowerCase();
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

function getAggregateActivityState(sessions: SessionNodeType[]): AggregateActivityState {
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

function buildActivitySummary(sessions: SessionNodeType[]): string {
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
    const longest = runningWork.reduce((max, session) => Math.max(max, session.duration), 0);
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

function getAggregateBadges(sessions: SessionNodeType[]): AggregateBadge[] {
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
export function pickBestSession(sessions: SessionNodeType[]): string | null {
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

/** Default to collapsed for every issue. The session list dominates the
 *  tree height when expanded — collapsed-by-default keeps the tree scannable.
 *  Users can expand individual features; that choice is persisted. */
function defaultExpandedFromState(_stateLabel: string): boolean {
  return false;
}

/** Compute the dominant session presence for the feature row StatusDot.
 *  Priority: active > thinking > waiting > idle > ended. */
function computeDominantStatus(sessions: SessionNodeType[]): StatusDotStatus {
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
function sessionMatchesFilter(session: SessionNodeType, filter: TreeSessionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'alive') return session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
  if (filter === 'failed') {
    const st = (session.status || '').toLowerCase();
    return st.includes('fail') || st.includes('error') || st.includes('stuck');
  }
  return true;
}

function FeatureMenu({
  x,
  y,
  onClose,
  feature,
  bestSessionId,
  hasJsonl,
  onOpenStateDir,
  onDeepWipe,
  onViewJsonl,
}: {
  x: number;
  y: number;
  onClose: () => void;
  feature: ProjectFeature;
  bestSessionId: string | null;
  hasJsonl: boolean;
  onOpenStateDir?: (sessionId: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        background: 'var(--card)',
        border: '1px solid var(--mc-border, var(--border))',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        minWidth: 160,
        fontSize: 12,
      }}
    >
      {bestSessionId && onOpenStateDir && (
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--foreground)',
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
          onClick={() => {
            onOpenStateDir(bestSessionId);
            onClose();
          }}
        >
          <FolderOpen size={14} />
          Open State Dir
        </button>
      )}
      {hasJsonl && bestSessionId && onViewJsonl && (
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--foreground)',
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
          onClick={() => {
            onViewJsonl(bestSessionId);
            onClose();
          }}
        >
          <FileText size={14} />
          View JSONL
        </button>
      )}
      {onDeepWipe && (
        <>
          <div style={{ height: 1, background: 'var(--mc-border, var(--border))', margin: '4px 8px' }} />
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--mc-error, #ef4444)',
              fontSize: 12,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            onClick={() => {
              const confirmed = window.confirm(
                `Deep wipe will destroy all data for ${feature.issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
              );
              if (confirmed) {
                onDeepWipe(feature.issueId);
              }
              onClose();
            }}
          >
            <Trash2 size={14} />
            Deep Wipe
          </button>
        </>
      )}
    </div>
  );
}

export function FeatureItem({ feature, isSelected, onSelect, selectedSessionId, onSelectSession, title, cost, filter = 'all', onStopSession, onViewTerminal, onPauseSession, onResumeSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl }: FeatureItemProps) {
  const [expanded, setExpanded] = useState(() => {
    const persisted = readExpanded(feature.issueId);
    return persisted ?? defaultExpandedFromState(feature.stateLabel);
  });
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, open: false });

  // Derive best session once per data change instead of on every click (PAN-821 review)
  // Respect the tree filter so auto-select picks a visible session.
  const visibleSessions = feature.sessions?.filter(s => sessionMatchesFilter(s, filter)) ?? [];
  const hasVisibleSessions = visibleSessions.length > 0;
  const bestSessionId = useMemo(() =>
    visibleSessions.length > 0 ? pickBestSession(visibleSessions) : null,
  [visibleSessions]);

  const hasJsonl = useMemo(() =>
    visibleSessions.some(s => s.hasJsonl),
  [visibleSessions]);

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
    if (bestSessionId && onSelectSession) {
      onSelectSession(feature.issueId, bestSessionId);
    }
  }, [onSelect, bestSessionId, feature.issueId, onSelectSession, expanded]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, open: true });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => ({ ...m, open: false }));
  }, []);

  const progressPct = feature.isRally && feature.childCount && feature.childCount > 0
    ? Math.round((feature.completedCount || 0) / feature.childCount * 100)
    : null;

  return (
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
        <button
          className={`${styles.featureItem} ${isSelected ? styles.featureItemSelected : ''}`}
          onClick={handleRowClick}
          onContextMenu={handleContextMenu}
        >
          <span className={styles.featureStatus}>
            {feature.isShadow ? (
              <Eye size={14} style={{ color: 'var(--mc-accent)' }} />
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
          <span className={styles.featureLabel} title={title || feature.issueId}>
            {title || feature.issueId}
          </span>
          {!feature.isRally && aggregateBadges.length > 0 && (
            <span className={styles.featureBadgeGroup}>
              {aggregateBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`${styles.featureBadge} ${styles[`featureBadge_${badge.tone}` as keyof typeof styles]}`}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          )}
          <ResourceStrip feature={feature} />
          {feature.isRally && feature.childCount != null && feature.childCount > 0 ? (
            <span className={styles.featureState} title={`${feature.completedCount || 0}/${feature.childCount} stories done${feature.inProgressCount ? `, ${feature.inProgressCount} active` : ''}`}>
              {feature.completedCount || 0}/{feature.childCount}
              {progressPct !== null && (
                <span style={{
                  display: 'inline-block',
                  width: 24,
                  height: 4,
                  marginLeft: 4,
                  background: 'var(--mc-border)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  verticalAlign: 'middle',
                }}>
                  <span style={{
                    display: 'block',
                    width: `${progressPct}%`,
                    height: '100%',
                    background: progressPct === 100 ? 'var(--mc-success)' : 'var(--mc-warning)',
                    borderRadius: 2,
                  }} />
                </span>
              )}
            </span>
          ) : (
            <span className={`${styles.featureState} ${styles[`featureState_${featureStateTone}` as keyof typeof styles]}`}>{feature.stateLabel}</span>
          )}
          {cost !== undefined && cost > 0 && (
            <span className={styles.featureCost}>{formatCost(cost)}</span>
          )}
        </button>
      </div>

      {menu.open && (
        <FeatureMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          feature={feature}
          bestSessionId={bestSessionId}
          hasJsonl={hasJsonl}
          onOpenStateDir={onOpenStateDir}
          onDeepWipe={onDeepWipe}
          onViewJsonl={onViewJsonl}
        />
      )}

      {expanded && hasVisibleSessions && (
        <div className={styles.sessionList}>
          {visibleSessions.map(session => (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
