import { Loader2, AlertTriangle, CheckCircle2, Circle, Eye, Layers, GitMerge } from 'lucide-react';
import type { ProjectFeature } from './ProjectNode';
import styles from '../styles/mission-control.module.css';

interface FeatureItemProps {
  feature: ProjectFeature;
  isSelected: boolean;
  onSelect: () => void;
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

export function FeatureItem({ feature, isSelected, onSelect, title, cost }: FeatureItemProps) {
  const progressPct = feature.isRally && feature.childCount && feature.childCount > 0
    ? Math.round((feature.completedCount || 0) / feature.childCount * 100)
    : null;

  return (
    <button
      className={`${styles.featureItem} ${isSelected ? styles.featureItemSelected : ''}`}
      onClick={onSelect}
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
  );
}
