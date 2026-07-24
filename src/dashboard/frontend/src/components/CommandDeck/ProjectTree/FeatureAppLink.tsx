import type { UatStackSummary } from '../UatStackStatus';
import styles from '../styles/command-deck.module.css';

/**
 * FeatureAppLink — 'app ↗' chip on an expanded issue tree row linking to the
 * workspace's frontend URL (e.g. https://feature-min-850.myn.localhost).
 * Renders only while the Docker stack is live (healthy/starting): gating on
 * live stack state, not phase, is what keeps PAN-2996's bogus
 * planning-phase chip from recurring.
 */
/** Merge-ready UAT stack-state chip (extracted verbatim from FeatureItem). */
export function FeatureUatChip({ summary }: { summary: UatStackSummary | null }) {
  if (!summary) return null;
  return (
    <span
      className={`${styles.featureBadge} ${summary.active ? styles.featureBadge_paused : styles.featureBadge_running}`}
      data-testid="feature-uat-stack"
      title="UAT workspace Docker stack status"
    >
      {`UAT ${summary.state === 'stale' ? 'idle' : summary.state}`}
    </span>
  );
}

export function FeatureAppLink({ frontendUrl, summary }: {
  frontendUrl?: string;
  summary: UatStackSummary | null;
}) {
  const live = summary?.state === 'healthy' || summary?.state === 'starting';
  if (!frontendUrl || !live) return null;
  return (
    <a
      href={frontendUrl}
      target="_blank"
      rel="noreferrer"
      className={styles.featureBadge}
      data-testid="feature-open-frontend"
      title={`Open ${frontendUrl}`}
      onClick={(e) => e.stopPropagation()}
    >
      app ↗
    </a>
  );
}
