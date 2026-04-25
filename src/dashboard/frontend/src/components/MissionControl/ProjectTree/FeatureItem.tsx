import { useState, useCallback, useMemo } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge, ChevronRight, ChevronDown } from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import type { ProjectFeature } from './ProjectNode';
import { SessionNode } from './SessionNode';
import styles from '../styles/mission-control.module.css';

interface FeatureItemProps {
  feature: ProjectFeature;
  isSelected: boolean;
  onSelect: () => void;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  title?: string;
  cost?: number;
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
  ended: 2,
};

/** Pick the best session to auto-select: active > idle > ended; among active prefer work > review > test. */
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

function readExpanded(issueId: string): boolean {
  try {
    return localStorage.getItem(getExpandedKey(issueId)) === 'true';
  } catch {
    return false;
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

export function FeatureItem({ feature, isSelected, onSelect, selectedSessionId, onSelectSession, title, cost }: FeatureItemProps) {
  const hasSessions = (feature.sessions?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(() => readExpanded(feature.issueId));

  // Derive best session once per data change instead of on every click (PAN-821 review)
  const bestSessionId = useMemo(() =>
    feature.sessions ? pickBestSession(feature.sessions) : null,
  [feature.sessions]);

  const handleToggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    setExpanded(next);
    writeExpanded(feature.issueId, next);
  }, [expanded, feature.issueId]);

  const handleRowClick = useCallback(() => {
    onSelect();
    if (bestSessionId && onSelectSession) {
      onSelectSession(feature.issueId, bestSessionId);
    }
  }, [onSelect, bestSessionId, feature.issueId, onSelectSession]);

  const progressPct = feature.isRally && feature.childCount && feature.childCount > 0
    ? Math.round((feature.completedCount || 0) / feature.childCount * 100)
    : null;

  return (
    <div className={`${styles.featureItemWrapper} ${isSelected ? styles.featureItemWrapperSelected : ''}`}>
      <div className={styles.featureItemRow}>
        {hasSessions ? (
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
        >
          <span className={styles.featureStatus}>
            {feature.isShadow ? (
              <Eye size={14} style={{ color: 'var(--mc-accent)' }} />
            ) : (
              <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} isRally={feature.isRally} readyForMerge={feature.readyForMerge} />
            )}
          </span>
          <span className={styles.featureId_sidebar}>{feature.issueId}</span>
          <span className={styles.featureLabel}>
            {title || feature.issueId}
          </span>
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
            <span className={styles.featureState}>{feature.stateLabel}</span>
          )}
          {cost !== undefined && cost > 0 && (
            <span className={styles.featureCost}>{formatCost(cost)}</span>
          )}
        </button>
      </div>

      {expanded && hasSessions && feature.sessions && (
        <div className={styles.sessionList}>
          {feature.sessions.map(session => (
            <SessionNode
              key={session.sessionId}
              session={session}
              isSelected={selectedSessionId === session.sessionId}
              onClick={() => onSelectSession?.(feature.issueId, session.sessionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
