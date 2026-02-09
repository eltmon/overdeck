import { Loader2, AlertTriangle, CheckCircle2, Circle, Eye } from 'lucide-react';
import type { ProjectFeature } from './ProjectNode';
import styles from '../styles/mission-control.module.css';

interface FeatureItemProps {
  feature: ProjectFeature;
  isSelected: boolean;
  onSelect: () => void;
  title?: string;
  cost?: number;
}

function StatusIcon({ status, agentStatus, stateLabel }: { status: string; agentStatus: string | null; stateLabel: string }) {
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
  return (
    <button
      className={`${styles.featureItem} ${isSelected ? styles.featureItemSelected : ''}`}
      onClick={onSelect}
    >
      <span className={styles.featureStatus}>
        {feature.isShadow ? (
          <Eye size={14} style={{ color: 'var(--mc-accent)' }} />
        ) : (
          <StatusIcon status={feature.status} agentStatus={feature.agentStatus} stateLabel={feature.stateLabel} />
        )}
      </span>
      <span className={styles.featureId_sidebar}>{feature.issueId}</span>
      <span className={styles.featureLabel}>
        {title || feature.issueId}
      </span>
      <span className={styles.featureState}>{feature.stateLabel}</span>
      {cost !== undefined && cost > 0 && (
        <span className={styles.featureCost}>{formatCost(cost)}</span>
      )}
    </button>
  );
}
