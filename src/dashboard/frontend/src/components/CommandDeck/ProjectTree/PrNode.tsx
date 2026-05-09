import { GitPullRequest } from 'lucide-react';
import styles from '../styles/command-deck.module.css';

export interface PrNodeProps {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url?: string;
}

export function PrNode({ number, title, state, isDraft, url }: PrNodeProps) {
  const handleClick = () => {
    if (url) window.open(url, '_blank');
  };

  return (
    <div className={styles.prNode} onClick={handleClick} title={`${title} (${state})`}>
      <GitPullRequest size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />
      <span className={styles.prNumber}>#{number}</span>
      <span className={styles.prTitle}>{title}</span>
      {isDraft && <span className={styles.branchBadge}>(draft)</span>}
      <span className={styles.branchBadge}>({state})</span>
    </div>
  );
}
