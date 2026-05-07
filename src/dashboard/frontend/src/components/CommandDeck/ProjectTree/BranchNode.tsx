import { GitBranch } from 'lucide-react';
import styles from '../styles/command-deck.module.css';

export interface BranchNodeProps {
  name: string;
  isLocal: boolean;
}

export function BranchNode({ name, isLocal }: BranchNodeProps) {
  return (
    <div className={styles.branchNode} title={name}>
      <GitBranch size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
      <span>{name}</span>
      <span className={styles.branchBadge}>({isLocal ? 'local' : 'remote'})</span>
    </div>
  );
}
